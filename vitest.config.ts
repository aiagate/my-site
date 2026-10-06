import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import config from "./cloudflare.config.ts";
import { assetsDirectory } from "./wrangler.config.ts";

const migrations = await readD1Migrations(
	fileURLToPath(new URL("./migrations", import.meta.url)),
);

export default defineConfig({
	plugins: [
		cloudflareTest(async () => ({
			main: config.worker.entrypoint,
			miniflare: {
				compatibilityDate: config.worker.compatibilityDate,
				d1Databases: { LIKES: config.worker.env.LIKES.id ?? "my-site-likes" },
				ratelimits: {
					LIKE_RATE_LIMIT: {
						namespace_id: config.worker.env.LIKE_RATE_LIMIT.namespace,
						simple: config.worker.env.LIKE_RATE_LIMIT.simple,
					},
				},
				assets: {
					directory: assetsDirectory,
					binding: "ASSETS",
				},
				bindings: { TEST_MIGRATIONS: migrations },
			},
		})),
	],
	test: {
		setupFiles: ["./test/setup.ts"],
	},
});
