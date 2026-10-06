# Worker起動削減の検討

## 現状と目的

静的アセットに一致しないリクエストは、Workerが起動してHonoの `app.notFound` から `ASSETS.fetch` に渡る。HTTP 404を返しても、起動済みなのでWorkersの実行として扱われる。目的は、通常の不明URLやPHP探索を動的Workerの外で処理すること。

CLI移行は設定形式とコマンドの入口を変える作業であり、それ自体では起動回数を減らさない。現在の `cloudflare.config.ts` は移行前と同じ配信構成を維持している。

## 選択肢

| 案 | 効果 | 負担・限界 |
|---|---|---|
| 1 Workerのまま `404-page` とAPIのWorker優先経路を追加 | ブラウザーの画面遷移で不明URLを静的404にでき、APIの画面遷移はJSONを維持できる | `Sec-Fetch-Mode: navigate` のない不明GET、HEAD、POST、OPTIONSはWorkerに入り得る。PHP探索削減の達成とは判断できない |
| 静的専用WorkerとAPI用Workerを分離 | 静的専用Workerにはコードのentrypointがなく、不明URLも動的コードを起動せず静的404へ進む | 2つの公開先・ビルド出力・デプロイを管理し、同一ドメインのAPI経路を設定する必要がある |

`runWorkerFirst` のnegativeパターンは、対応するリクエストをアセット側へ直接送れる。ただしglobのみでnegativeが優先されるため、全URLを除外する `!/*` と `/api/likes/*` を並べてもAPIが動かなくなる。小規模ブログで全URLの補集合を列挙する構成は採用しない。

## 分離する場合の最小案

- 既存の `my-site` を静的専用にし、同じ `dist` を配信する。HTMLの末尾スラッシュ・静的ファイル・ヘッダーを維持し、404.htmlを静的側で配信する。
- 別Workerへ既存Hono APIとD1・レート制限を移す。`/api/likes/*` のみ同じ `shimae.net` の経路として接続する。POSTのOrigin検査を維持し、CORSは開放しない。
- 公開記事判定の `post-slugs.json` はAPI Workerにも静的アセットとして持たせる最小案がある。同じビルドから両方を更新するため、公開順序・一時的な不一致を管理する必要がある。サービスバインディングで正本を参照する案はアップロードの重複を減らすが、設定が増える。
- 未知の `/api/unknown` は静的側で404、未知の `/api/likes/<slug>` はAPIで404とする。API経路に来る不要なアクセスのWorker起動は残る。
- workers.devやプレビューURLは経路制限とは別の入口なので、公開時にAPI Worker側で無効化するか、別の公開URLとして起動が残ることを明記する。

分離案の実装候補は次節の通り。本番適用前に追加リソースの承認と品質確認を完了する。

## 検証の基準

HTTPステータスとWorker起動の有無を別々に確認する。通常GETと `Sec-Fetch-Mode: navigate` を付けたGET、HEAD、POST、OPTIONSについて、ホーム・記事・リダイレクト・PHP探索・未知URL・既知API・未知APIを確認する。

ローカル検証はクラウドの課金メトリクスを証明しない。公開後は既存のログ/メトリクスで、静的経路のWorker起動がなく、API経路だけが動的実行されることを確認する。本番への負荷試験は行わない。

## 公式資料（2026-10-05確認）

- [Static Assets: Worker script](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Static Site Generation and custom 404 pages](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)
- [Static Assets configuration and bindings](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare CLI migration](https://developers.cloudflare.com/cf/wrangler/migrate/)

## 2026-10-06: 分離構成の実装候補と公開手順

CLI移行だけではPHP探索のWorker起動を減らせない。実装候補は既存 `my-site` をentrypointなしの静的専用Workerにし、新しい `my-site-api` に既存のHono・D1・レート制限を移す。既存の `shimae.net` と `www.shimae.net` のCustom Domainsは同じ `my-site` に残す。APIには `shimae.net/api/likes/*` と `www.shimae.net/api/likes/*` の2 Routesを設定する。Cloudflareでは同じhostnameのRouteがCustom Domainに優先する。DNSレコードやセキュリティ設定の変更は予定しない。

`site/` と `api/` はpnpmワークスペース内の2つのビルドプロジェクト。両方で `cf build` / `cf deploy` を使い、Wranglerはビルドにだけ使う。新CLIはワークスペース直下のビルドを拒否するため、各プロジェクトを明示して実行する。

- 静的WorkerにコードもD1もレート制限も持たせない。404の本文・ステータスを含め、従来のassets既定動作を維持し、SPAの200 fallbackを導入しない。
- APIは同じビルドで生成された `post-slugs.json` のみをassetsとして持つ。`runWorkerFirst: true` によりnavigateもJSONを維持する。APIの未知経路はJSON404・no-storeとなり、記事やmanifestをAPIから二重配信しない。
- D1 ID・rate namespace・同Origin POST検査は維持する。新しいDB・マイグレーション・課金サービスは不要。APIのworkers.devとpreview URLsは無効化する。既存静的Workerのworkers.dev入口は静的配信のまま維持する。
- API経路への探索は引き続き動的起動になる。`/api/likes`（末尾slashなし）や未知の `/api/unknown` は静的側へ行く。wildcard経路に入る不正slug・追加segment・二重slashはAPI404へ行く。
- 静的assetsの配信と保存には追加料金がない。APIリクエストとD1の現行課金・上限は残る。新Worker用のプラン購入・アップグレードはしない。削減額は本番メトリクスを見て判断する。

### 本番前の条件

新Workerと両Routes追加の承認、APIを先に接続する順序への同意、品質チェック・独立レビュー・CI成功が必要。既存トークンでWorkers Scripts Writeと対象zoneのWorkers Routes Writeが必要。両Custom Domainsの再同期にも既存権限が必要になる場合がある。読み取り成功や `cf deploy --dry-run` は書き込み権限を証明しない。403なら強制・権限拡張・別経路での回避をせず停止する。

### 初回公開

初回分離は現在の公開3記事（`hello`、`what-role-for-me`、`ai-ronpa-kaikan-driven-development`）を維持する。未公開の匿名いいね記事は `draft: true` としてソースを保存し、両ビルドとSEO出力から除外する。公開記事集合の一致チェックは維持し、この記事の公開を分離作業に含めない。

1. 変更前に `cf workers deployments list --worker my-site` で100%配信中のversionと割合を控える。Custom Domains、Routes、workers.dev設定も読み取りで控える。D1変更は行わない。
2. 品質確認済みの同じcommitから `pnpm build` で両出力を生成する。
3. 初回は `node tools/check-public-manifest.ts` で既存Routesが空であることと、現在公開中の記事集合とcandidateが両hostで一致することを確認する。不一致なら記事の追加・削除を今回の分離と同時に行わず停止する。`pnpm deploy:api` でAPIと2 Routesを接続する。途中失敗時は既存 `my-site` を静的専用へ変えない。
4. `node tools/smoke-api.ts` でRoutesが意図した2件だけで両方が新APIを指すこと、APIの配信version・D1/rate設定・workers.devとpreviewの無効化を読み取る。旧Workerも同じAPI応答を返せるため、HTTP成功だけで接続完了としない。両ドメインの既存記事GET/HEAD、JSON・no-store・CORSなしも確認する。いいねの更新はしない。
5. 成功後に `pnpm deploy:static` で既存Workerをassets-only化する。`pnpm deploy` はビルドと3〜5を順に実行する。
6. 両hostでトップ、代表記事、Markdown、CSS/JS、robots、sitemap、llms、末尾slashリダイレクト、不明GET/HEAD、PHP探索、APIのreadを少数のリクエストで確認する。現在versionのメタデータに実行moduleがなく、API経路は別Workerであることを確認する。既存ログ/メトリクスでも静的経路の動的起動が残っていないか確認する。ローカルの無起動テストだけをクラウド課金の証明として扱わない。

### 復旧

先に旧 `my-site` versionを100%へ戻し、記事とAPIを処理できる状態にする。その後、今回追加したAPIの2 Routesだけを削除して既存Workerへ戻す。他のRoutes・Custom Domains・DNS・DBを変更しない。新Workerを消す必要はない。新しいDBマイグレーションを行わないため、旧versionも同じlikes DBをそのまま参照できる。

旧versionへの復帰は `cf workers deployments create --worker my-site --strategy percentage --versions @rollback-versions.json` を使う。JSONは事前に控えたversion_idとpercentageの配列とし、bypassのフラグは使わない。Route削除の対象は公開前後の一覧差分と一致する2件に限る。部分的なAPI接続や静的デプロイ失敗があった場合もこの順序で戻し、両hostの読み取り確認を再実行する。

### ローカル検証の限界

経路テストは実ビルドbundleとassetsをMiniflareで動かす。Miniflareはassets-onlyでもローカル用moduleを要求するため、静的側には呼ばれたら失敗する検出用moduleを置く。これは本番出力には含まれず、テストで本番のmanifestとbundleが存在しないことも別途確認する。ローカルの前段routerはCloudflare Routesの代役であり、本番のpath正規化やメトリクスは本番read smokeで確認する。

追加資料: [RoutesとCustom Domainsの優先順位](https://developers.cloudflare.com/workers/configuration/routing/routes/)。


### 記事の追加・削除を行う後続の公開

2 Workerの公開は原子的ではない。APIを先に更新する短い間、新規slugは静的記事の公開前にAPIから認識され、削除slugは旧ページがまだ配信されていてもAPI404になる。初回分離では前述の一致チェックでこのずれを禁止する。後続の通常の記事公開では同じbuildからAPI→静的を速やかに更新し、この一時差分を公開者が把握する。静的更新に失敗した場合は、事前に控えた旧API versionも戻して公開中のページ集合に一致させ、部分成功のまま放置しない。新規記事・削除記事の完全な同時切替が必要になった時点で、公開方式を再検討する。
