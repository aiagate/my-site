import { defineWranglerConfig } from "wrangler/experimental-config";

export const assetsDirectory = "./dist";

export default defineWranglerConfig({
	types: {
		generate: false,
	},
	assetsDirectory,
});
