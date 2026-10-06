---
title: "Cloudflare WorkersとD1によるミニマルな匿名いいね機能の実装"
description: "CMSや認証を導入せず、静的ブログにCloudflare WorkersとD1で匿名いいね機能を追加した設計と実装のまとめ。"
createdAt: "2026-09-14T03:15:00.000Z"
draft: true
---

本ブログ（shimae.net）に、記事ごとの「いいね」機能を追加した。

CMSやログイン機能、外部サービスを増やさず、既存のCloudflare Workersによる静的アセット配信にD1のカウンターを組み合わせた最小構成で実装している。

なぜこの構成にしたのかという設計上の判断と、Worker API、D1、クライアント、テストの具体的な実装内容をまとめる。

## なぜこの構成にしたのか

本ブログの開発・運用方針を定めた [`docs/engineering-inception-deck.md`](https://github.com/aiagate/my-site/blob/main/docs/engineering-inception-deck.md) では、「Lean」な姿勢を基本とし、Markdownの静的生成とCloudflareでの配信によって執筆と低負担な長期運用に集中することを重視している。

そのため、ログインや会員機能、コメント、CMS、アクセス解析、利用者データを扱う仕組みは原則として対象外としている。これらは運用負担や複雑性を高め、発信の継続を妨げる要因になるためである。

一方で、閲覧者が記事へ反応できる最小限の手段として「D1に保存する匿名の累積いいね数」のみを許容する方針をとった。

ブログを書いて公開し続ける動機として、読者からのポジティブな反応が得られることは素朴に励みになる。1人1票の厳密な評価に限らず、1人の読者から複数回届くような熱量のある反応であっても、書き手としては素直に嬉しい。行動の結果として肯定的な刺激やフィードバックを得ることで次の行動が促される仕組みは、脳の報酬系や[報酬学習](https://pmc.ncbi.nlm.nih.gov/articles/PMC10572094/)の観点からも説明される。神経科学的な断定を過剰にする必要はないが、継続的な発信のための自然な動機づけとして、読者のリアクションを可視化することには確かな意義がある。

利用者の識別（ユーザーIDやCookie）、行動履歴、個人別の状態管理を求めず、連打を許容する累積カウンターだけに割り切ることで、利用者データの管理リスクを負わずにシンプルな仕組みを実現できる。

また、本ブログでは本人の明示承認と手動デプロイを原則としており、デプロイやD1マイグレーションなどの外部状態変更はサイト運営者が確認して行う。今回の下書き追加や設計もその運用方針に基づいている。

## D1のテーブル設計と加算処理

累積いいね数を保存するCloudflare D1には、`article_likes` テーブルを1つだけ作成している。マイグレーションファイル（[`migrations/0001_article_likes.sql`](https://github.com/aiagate/my-site/blob/main/migrations/0001_article_likes.sql)）の定義は次のとおりである。

```sql
CREATE TABLE article_likes (
  slug TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
) WITHOUT ROWID;
```

### 1行への累積方式を採用した理由

D1でいいねカウンターを管理する際、主に次の2つの設計アプローチが考えられる。

1. **いいねごとに1行を記録する方式**: 押下イベントごとにレコード（IDや作成日時など）を挿入し、集計クエリで件数を算出する。
2. **記事ごとに1行へ累積する方式**: 記事のslugを主キーとし、単一の数値カラムにカウントを累積更新する（本ブログの採用方式）。

本機能では後者の「記事ごとに1行へ累積する方式」を採用した。

匿名の累積値だけを扱う本ブログでは、誰がいついいねを押したかという利用者履歴や時系列ログを保持する必要がない。記事ごとに1行へ累積する構成にすることで、以下の利点が得られる。

- **保存データの抑制**: いいね数に比例してテーブル容量や行数が増加せず、記事数（数十〜数百行程度）に応じた最小限のストレージ消費に抑えられる。
- **クエリの単純化と低負荷**: 集計のための `COUNT(*)` スキャンが不要となり、主キー検索による単一行の読み取り（`SELECT count FROM article_likes WHERE slug = ?`）で即座に現在のカウントを取得できる。
- **運用負担の軽減**: 肥大化するイベントログのパージやパーティショニング、古い履歴の管理といった運用作業が一切発生しない。利用者履歴を持たないという設計方針にも自然に合致する。

テーブル定義でも記事の `slug` とカウント値 `count` のみを持たせており、閲覧者のID、Cookie、IPアドレス、タイムスタンプなどは保存しない。

### UPSERTによるアトミックな加算

いいねの加算処理（[`src/likes.ts`](https://github.com/aiagate/my-site/blob/main/src/likes.ts)）では、SQLiteのUPSERT構文（`INSERT ... ON CONFLICT DO UPDATE`）を使用している。

```sql
INSERT INTO article_likes (slug, count)
VALUES (?, 1)
ON CONFLICT(slug) DO UPDATE SET count = count + 1
RETURNING count
```

レコードが存在しない初回は `count = 1` で新規作成し、既存レコードがある場合は `count = count + 1` で加算して、更新後のカウント値を `RETURNING count` で直接返す。
また、現在のカウント取得（`GET` 用）は `SELECT count FROM article_likes WHERE slug = ?` で取得する。

## Cloudflare WorkersによるAPIと保護機構

いいね機能のバックエンドは、Honoを用いたCloudflare Worker（[`src/app.ts`](https://github.com/aiagate/my-site/blob/main/src/app.ts)）で処理している。エンドポイントは `GET /api/likes/:slug` と `POST /api/likes/:slug` の2つである。

### 1. 公開記事のマニフェスト検証

存在しない記事へのいいねや、任意のキーへの書き込みを防ぐため、公開済み記事のslugのみを受け付ける検証を行っている。

静的サイトのビルドスクリプト（`tools/build.ts`）で全記事のslugを抽出した `dist/post-slugs.json` を生成している。Worker側（[`src/published-posts.ts`](https://github.com/aiagate/my-site/blob/main/src/published-posts.ts)）では、静的アセットバインディング（`ASSETS`）を通じてこのマニフェストを取得し、リクエストされたslugが含まれているかを検証する。

slugが形式規則（英小文字、数字、ハイフン）を満たさない場合や、マニフェストに存在しない記事宛てのリクエストには、GET・POSTともに `404 Not Found` を返す。

### 2. 同一Origin検証

`POST /api/likes/:slug` へのリクエストでは、CSRFや外部サイトからの無制限な呼び出しを抑止するため、`Origin` ヘッダーを検証している。

リクエストの `Origin` ヘッダーとWorker自身のリクエストURLの origin を比較し、一致しない場合は `403 Forbidden`（`{ "error": "Invalid origin" }`）を返して更新を拒否する。

### 3. Rate Limiting（10秒間に30回）

連打による極端な負荷や悪用を抑止するため、Cloudflare WorkersのRate Limitingバインディング（`wrangler.jsonc` の `LIKE_RATE_LIMIT`、limit: 30, period: 10）を導入している。

クライアントのIPアドレス（`CF-Connecting-IP` ヘッダー）をキーにしてレート制限を判定し、10秒間に30回を超えた場合は `429 Too Many Requests` を返して加算を行わない。
この制限はデータセンターごとに適用される緩やかな悪用抑止であり、キーとして使用したIPアドレスをWorkerやD1に永続化することはない。

### 4. キャッシュ制御と未対応メソッドの拒否

いいねの数値は動的に変化するため、APIレスポンスには `Cache-Control: no-store` ヘッダーを付与してCDNやブラウザによるキャッシュを防いでいる。
また、GETとPOST以外のHTTPメソッド（PUTやDELETEなど）に対しては `405 Method Not Allowed` を返す。

## クライアント側の実装と非冪等性

ブラウザ側のスクリプト（[`public/likes.js`](https://github.com/aiagate/my-site/blob/main/public/likes.js)）は、Vanilla JSで書かれた小さな実装である。

- ページ読み込み時に `GET /api/likes/:slug` を呼び出して現在のいいね数を表示する。
- ボタン押下時にボタンを非活性（disabled）にし、`POST /api/likes/:slug` を送信してカウントを更新する。

ここで重要なのは、いいねの加算処理が「非冪等（呼び出すたびにカウントが増える）」である点である。
もしネットワークのタイムアウトやエラー時にクライアントが自動で再試行を行うと、サーバー側では加算が成功していた場合にさらに二重でカウントが増えてしまう可能性がある。

そのため、本実装では通信失敗時の自動再試行は行わず、「いいねに失敗しました。反映済みの可能性があります。」というメッセージを表示するに留めている。

## テストによる仕様の検証

この機能は、Vitestと `@cloudflare/vitest-plugin` を使った結合テスト（[`test/likes.spec.ts`](https://github.com/aiagate/my-site/blob/main/test/likes.spec.ts)）で動作を検証している。

テスト実行前にWorkers runtime内でD1マイグレーションを適用し、テストケースごとにテーブルをクリーンアップした上で、以下の振る舞いを確認している。

- **連打時の累積**: POSTごとにカウントが 1 -> 2 と増えること
- **現在値の取得**: GETで最新の累積数を返せること
- **未公開記事の除外**: マニフェストに存在しないslug宛てのPOSTに404を返すこと
- **他Originの拒否**: 異なるOriginからのPOSTに403を返すこと
- **同一IPからの連打制限**: 同一の `CF-Connecting-IP` から10秒間に30回を超えてPOSTした場合に429を返し、D1のカウントが30で止まること
- **未対応メソッドの拒否**: PUTリクエストに対して405を返すこと

また、静的アセット側のテスト（[`test/static-assets.spec.ts`](https://github.com/aiagate/my-site/blob/main/test/static-assets.spec.ts)）では、ビルドによって `post-slugs.json` にslugが重複なく出力されていることも確認している。

## まとめ

本ブログのいいね機能は、CMSや認証機構などの大きなレイヤーを導入することなく、Cloudflare Workers、D1、静的アセットマニフェストという最小限の部品だけで組み立てられている。

匿名性と単機能に割り切ることで、セキュリティリスクや運用保守の負担を最小限に抑えつつ、静的ブログに読者の反応を受け取る仕組みを持たせることができた。

## 参考資料

- [Query D1 · Cloudflare D1 docs](https://developers.cloudflare.com/d1/best-practices/query-d1/)
- [Workers Static Assets · Cloudflare Workers docs](https://developers.cloudflare.com/workers/static-assets/)
- [Rate Limiting · Cloudflare Workers runtime APIs](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
- [Dopamine, reward learning, and synaptic plasticity - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10572094/)
