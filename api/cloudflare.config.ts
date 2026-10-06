import { bindings, defineConfig, triggers } from "cf/config";

export default defineConfig({
	worker: {
		name: "my-site-api",
		compatibilityDate: "2026-08-17",
		entrypoint: "../src/worker.ts",
		workersDev: false,
		previewUrls: false,
		triggers: [
			triggers.fetch({ pattern: "shimae.net/api/likes/*", zone: "shimae.net" }),
			triggers.fetch({
				pattern: "www.shimae.net/api/likes/*",
				zone: "shimae.net",
			}),
		],
		// The manifest is internal; even navigation requests must reach the API.
		assets: { runWorkerFirst: true },
		observability: { enabled: true },
		env: {
			LIKES: bindings.d1({
				name: "my-site-likes",
				id: "9f784723-b63b-4a28-b476-70014e5146fb",
			}),
			LIKE_RATE_LIMIT: bindings.rateLimit({
				namespace: "78001631",
				simple: { limit: 30, period: 10 },
			}),
			ASSETS: bindings.assets(),
		},
	},
});
