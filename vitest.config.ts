import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import config from "./api/cloudflare.config.ts";

const migrations = await readD1Migrations(
	fileURLToPath(new URL("./migrations", import.meta.url)),
);

export default defineConfig({
	test: {
		projects: [
			{
				plugins: [
					cloudflareTest(() => ({
						main: "./src/worker.ts",
						miniflare: {
							compatibilityDate: config.worker.compatibilityDate,
							d1Databases: { LIKES: "test-likes" },
							ratelimits: {
								LIKE_RATE_LIMIT: {
									namespace_id: config.worker.env.LIKE_RATE_LIMIT.namespace,
									simple: config.worker.env.LIKE_RATE_LIMIT.simple,
								},
							},
							assets: {
								directory: "./dist-api",
								binding: "ASSETS",
								run_worker_first: true,
							},
							bindings: { TEST_MIGRATIONS: migrations },
						},
					})),
				],
				test: {
					name: "api",
					include: ["test/likes.spec.ts"],
					setupFiles: ["./test/setup.ts"],
				},
			},
			{
				test: {
					name: "routing",
					include: [
						"test/static-assets.spec.ts",
						"test/routing.spec.ts",
						"test/deploy.spec.ts",
					],
				},
			},
		],
	},
});
