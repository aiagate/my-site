import fs from "node:fs";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import api from "../api/cloudflare.config.ts";
import site from "../site/cloudflare.config.ts";

// The front router and static guard exist only locally. Production serves
// static assets directly with no entrypoint. Test the actual cf build output.
export async function localRuntime(persist = false) {
	const runtime = new Miniflare(
		convertV4MiniflareOptions({
			port: persist ? 8787 : 0,
			cf: false,
			d1Persist: persist ? ".wrangler/local-d1" : false,
			workers: [
				{
					name: "local-router",
					modules: true,
					compatibilityDate: site.worker.compatibilityDate,
					script: `export default {
						async fetch(request, env) {
							const pathname = new URL(request.url).pathname;
							if (pathname === '/__local_init' && request.method === 'POST') {
								await env.LIKES.exec(env.LOCAL_SCHEMA);
								return new Response(null, { status: 204 });
							}
							return (pathname.startsWith('/api/likes/') ? env.API : env.SITE).fetch(request);
     }
    };`,
					serviceBindings: { API: "api", SITE: "static" },
					d1Databases: { LIKES: "local-likes" },
					bindings: {
						LOCAL_SCHEMA: fs
							.readFileSync("migrations/0001_article_likes.sql", "utf8")
							.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS ")
							.replaceAll("\n", " "),
					},
				},
				{
					name: "static",
					modules: true,
					compatibilityDate: site.worker.compatibilityDate,
					// The local runtime requires a module. If invoked the request must fail.
					script:
						'export default { fetch() { throw new Error("Static user code was invoked"); } };',
					assets: {
						directory: "site/.cloudflare/output/v0/workers/default/assets",
						routerConfig: {
							has_user_worker: false,
							not_found_handling: site.worker.assets.notFoundHandling,
						},
					},
				},
				{
					name: "api",
					modules: true,
					compatibilityDate: api.worker.compatibilityDate,
					scriptPath:
						"api/.cloudflare/output/v0/workers/default/bundle/worker.js",
					d1Databases: { LIKES: "local-likes" },
					ratelimits: {
						LIKE_RATE_LIMIT: {
							namespace_id: api.worker.env.LIKE_RATE_LIMIT.namespace,
							simple: api.worker.env.LIKE_RATE_LIMIT.simple,
						},
					},
					assets: {
						directory: "api/.cloudflare/output/v0/workers/default/assets",
						binding: "ASSETS",
						run_worker_first: api.worker.assets.runWorkerFirst,
						routerConfig: { has_user_worker: true },
					},
				},
			],
		}),
	);
	try {
		// Initialise through the local runtime, avoiding synchronous Node proxies.
		const response = await runtime.dispatchFetch(
			"http://localhost/__local_init",
			{ method: "POST" },
		);
		if (response.status !== 204)
			throw new Error("Local schema initialisation failed");
		return runtime;
	} catch (error) {
		await runtime.dispose();
		throw error;
	}
}
