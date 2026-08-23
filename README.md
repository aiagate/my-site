# shimae.net

Markdownで書いた記事を静的サイトとして公開する個人ブログです。

## 開発

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

出力された `database_id` を [wrangler.jsonc](wrangler.jsonc) の `database_id` に設定し、続けてテーブルを作成します。

```sh
pnpm db:migrate
```

最後に `pnpm build` と `pnpm deploy` を実行します。D1データベースの作成・マイグレーション・デプロイは外部状態を変更するため、サイト運営者が確認して実行します。

### テスト

`pnpm test` はビルド後に、Cloudflare Workers runtime内でD1マイグレーションを適用して実行します。連打時の累積、未知記事、他Origin、HTTPメソッドを検証します。

いいねの加算は意図的に非冪等です。通信失敗時にブラウザから自動再試行すると、実際には反映済みだった場合にもさらに1増えるため、自動再試行は行いません。

### 悪用時の操作

Cloudflare Dashboard で `/api/likes/*` にレート制限ルールを1つ設定します。通常は「同じ送信元から10秒に30回程度」を許可し、超過分には Managed Challenge を使うのが目安です。異常な連打が続く場合は、このルールを厳しくするか、`/api/likes/*` を一時的にブロックします。
