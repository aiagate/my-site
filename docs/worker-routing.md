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

分離案はローカル実装の範囲を選択後に進める。今回、本番のドメイン・経路・設定は変更していない。

## 検証の基準

HTTPステータスとWorker起動の有無を別々に確認する。通常GETと `Sec-Fetch-Mode: navigate` を付けたGET、HEAD、POST、OPTIONSについて、ホーム・記事・リダイレクト・PHP探索・未知URL・既知API・未知APIを確認する。

ローカル検証はクラウドの課金メトリクスを証明しない。公開後は既存のログ/メトリクスで、静的経路のWorker起動がなく、API経路だけが動的実行されることを確認する。本番への負荷試験は行わない。

## 公式資料（2026-10-05確認）

- [Static Assets: Worker script](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [Static Site Generation and custom 404 pages](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/)
- [Static Assets configuration and bindings](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Static Assets billing and limitations](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/)
- [Cloudflare CLI migration](https://developers.cloudflare.com/cf/wrangler/migrate/)
