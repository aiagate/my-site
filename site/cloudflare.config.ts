import { defineConfig } from "cf/config";

export default defineConfig({
	worker: {
		name: "my-site",
		compatibilityDate: "2026-08-17",
		domains: ["shimae.net", "www.shimae.net"],
		// Assets only: an unknown URL must never fall through to user code.
		assets: { notFoundHandling: "none" },
		observability: {
			enabled: true,
		},
	},
});
