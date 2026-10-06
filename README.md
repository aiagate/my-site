# shimae.net

Markdownで書いた記事を静的サイトとして公開する個人ブログです。

## 開発

Node.js 22.18以上とpnpm 11.22.0以上を使います。Cloudflare CLI (`cf`) はプロジェクトの開発依存に含まれます。

```sh
pnpm install
pnpm dev
```

品質チェックとビルドは次のコマンドで実行します。

```sh
pnpm check
pnpm test
pnpm build
```

`pnpm check`はBiomeによる静的検査とTypeScriptの型検査を実行します。
`pnpm build` は同じ記事一覧から静的サイトとAPI用マニフェストを生成し、両プロジェクトで `cf build` を実行します。出力先は `site/.cloudflare/output/` と `api/.cloudflare/output/` です。`pnpm dev` はこの出力をローカルの同じOriginで配信し、独立したローカルD1を使います。

静的配信の設定は [site/cloudflare.config.ts](site/cloudflare.config.ts)、APIの設定は [api/cloudflare.config.ts](api/cloudflare.config.ts) が正本です。各ディレクトリの `wrangler.config.ts` はビルド設定だけを持ちます。CLIの入口は `cf` に移行しましたが、ビルド実装は引き続きWranglerを利用します。`cf` はbetaのためバージョンを固定し、更新時はビルド・型検査・APIテストを確認します。

D1のSQLは `migrations/` に置きます。`db:migrate` は `cf d1 migrations apply <database-id> --dir ./migrations` を使い、本番データベースを変更します。既存の本番D1は分離時に再作成・マイグレーションしません。ローカルテストは独立したD1へ同じSQLを適用します。

不要なWorker起動を減らす構成の比較と残る確認は [配信経路の検討](docs/worker-routing.md) を参照してください。

新しい記事は次のコマンドで作成します。

```sh
pnpm new:post <slug> "<title>"
```

## 記事いいね

記事ページの「いいね」は、Cloudflare Worker の `POST /api/likes/<slug>` が D1 のカウンターを1増やす機能です。ページ表示時は `GET /api/likes/<slug>` で現在の累積数を表示します。公開済み記事のslug以外は受け付けません。閲覧者のID、Cookie、IPアドレス、いいね履歴は保存しません。

### 初回設定

Cloudflare にログイン済みの状態で、次を実行します。

```sh
pnpm db:create
```

出力されたデータベースIDを [api/cloudflare.config.ts](api/cloudflare.config.ts) の `LIKES.id` と `package.json` の `db:migrate` に設定し、続けてテーブルを作成します。既存のデータベースを使う場合、再作成は不要です。

```sh
pnpm db:migrate
```

公開前に `pnpm check` と `pnpm test` を実行し、記事の公開判断と構成変更の承認を済ませます。`pnpm deploy` は確認済みcommitから両出力を再生成し、初回分離では現在公開中の記事集合との一致を確認します。APIを先にデプロイし、両Routesの接続先・配信中のversion・D1/rate設定・代替公開URLの無効化と両ドメインのGET/HEADが正常であることを確認してから静的サイトをデプロイします。API確認の失敗時は静的サイトを切り替えません。初回分離には新Worker `my-site-api` と `shimae.net/api/likes/*`・`www.shimae.net/api/likes/*` のRoutesを追加する承認が必要です。復旧と権限の条件は [配信経路の検討](docs/worker-routing.md) を参照してください。D1データベースの作成・マイグレーション・デプロイは外部状態を変更するため、サイト運営者が確認して実行します。

### テスト

`pnpm test` はビルド後に、Cloudflare Workers runtime内で独立したD1へSQLを適用します。連打時の累積、未知記事、他Origin、HTTPメソッドに加え、実ビルド出力のコード分離・同一マニフェスト・両hostの静的/動的経路を検証します。CIはこの品質確認だけを実行し、自動公開はしません。

いいねの加算は意図的に非冪等です。通信失敗時にブラウザから自動再試行すると、実際には反映済みだった場合にもさらに1増えるため、自動再試行は行いません。

### レート制限

`POST /api/likes/<slug>` は、Cloudflare Workers のRate Limitingバインディングにより、送信元IPごとに10秒間で30回まで受け付けます。超過時はいいねを加算せず、HTTP 429を返します。設定値は [cloudflare.config.ts](cloudflare.config.ts) の `LIKE_RATE_LIMIT` で管理します。

この制限はCloudflareのデータセンターごとに適用される、緩やかな悪用抑止です。IPアドレスをアプリケーションやD1に保存することはありません。
