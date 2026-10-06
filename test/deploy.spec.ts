import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import api from "../api/cloudflare.config.ts";

const account = "0123456789abcdef0123456789abcdef";
const correctRoutes = api.worker.triggers.map((trigger) => ({
	pattern: trigger.pattern,
	script: api.worker.name,
}));
let routes = correctRoutes;
let dbId = api.worker.env.LIKES.id;
let active = true;
let alternateUrl = false;
let missingUrlSettings = false;
let cacheControl = "no-store";
let denyMetadata = false;
let published: unknown;
let publicRequests = 0;

beforeEach(() => {
	vi.resetModules();
	vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-only");
	vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", account);
	routes = correctRoutes;
	dbId = api.worker.env.LIKES.id;
	active = true;
	alternateUrl = false;
	missingUrlSettings = false;
	cacheControl = "no-store";
	denyMetadata = false;
	publicRequests = 0;
	published = JSON.parse(fs.readFileSync("dist/post-slugs.json", "utf8"));
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = new URL(input);
			if (url.hostname !== "api.cloudflare.com") {
				publicRequests++;
				return new Response(
					init?.method === "HEAD"
						? null
						: JSON.stringify(
								url.pathname === "/post-slugs.json" ? published : { count: 0 },
							),
					{
						headers: {
							"Content-Type": "application/json",
							"Cache-Control": cacheControl,
						},
					},
				);
			}
			if (denyMetadata) return new Response(null, { status: 403 });
			let result: unknown;
			if (url.pathname.endsWith("/zones"))
				result = [{ id: "zone-id", account: { id: account } }];
			else if (url.pathname.endsWith("/routes")) result = routes;
			else if (url.pathname.endsWith("/deployments"))
				result = {
					deployments: active
						? [
								{
									versions: [
										{ version_id: "verified-version", percentage: 100 },
									],
								},
							]
						: [],
				};
			else if (url.pathname.endsWith("/settings"))
				result = {
					bindings: [
						{ type: "d1", name: "LIKES", id: dbId },
						{
							type: "ratelimit",
							name: "LIKE_RATE_LIMIT",
							namespace_id: api.worker.env.LIKE_RATE_LIMIT.namespace,
							simple: api.worker.env.LIKE_RATE_LIMIT.simple,
						},
					],
				};
			else if (url.pathname.endsWith("/subdomain"))
				result = missingUrlSettings
					? {}
					: { enabled: alternateUrl, previews_enabled: false };
			else throw new Error("Unexpected metadata request in test");
			return new Response(JSON.stringify({ success: true, result }), {
				headers: { "Content-Type": "application/json" },
			});
		}),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe("静的切替前の公開ゲート", () => {
	it("旧WorkerのHTTPが正常でも新APIのRouteがなければ停止する", async () => {
		routes = [];
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"Unexpected Worker Routes",
		);
		expect(publicRequests).toBe(0);
	});
	it("片方のhostだけのRouteでは停止する", async () => {
		routes = correctRoutes.slice(0, 1);
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"Unexpected Worker Routes",
		);
	});
	it("より具体的なRouteによる上書きがあれば停止する", async () => {
		routes = [
			...correctRoutes,
			{ pattern: "shimae.net/api/likes/hello", script: "other-worker" },
		];
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"Unexpected Worker Routes",
		);
	});
	it("新APIの配信versionが確認できなければ停止する", async () => {
		active = false;
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"active version",
		);
	});
	it("異なるD1に接続したAPIは受け入れない", async () => {
		dbId = "another-database";
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"D1 and rate-limit",
		);
	});
	it("APIの代替公開URLが有効なら停止する", async () => {
		alternateUrl = true;
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"alternative public URLs",
		);
	});
	it("APIの代替公開URLの設定を取得できなければ停止する", async () => {
		missingUrlSettings = true;
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"alternative public URLs",
		);
	});
	it("APIのreadがキャッシュ可能なら停止する", async () => {
		cacheControl = "public, max-age=3600";
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow(
			"API check failed",
		);
	});
	it("metadataの権限不足をHTTP成功で代用しない", async () => {
		denyMetadata = true;
		await expect(import("../tools/smoke-api.ts")).rejects.toThrow("HTTP 403");
		expect(publicRequests).toBe(0);
	});
	it("正しい経路・version・bindingと両hostのGET/HEADを確認する", async () => {
		await expect(import("../tools/smoke-api.ts")).resolves.toBeDefined();
		expect(publicRequests).toBe(4);
	});
	it("初回分離では記事集合を同時に変えない", async () => {
		routes = [];
		published = ["new-unpublished-post"];
		await expect(import("../tools/check-public-manifest.ts")).rejects.toThrow(
			"currently published article set",
		);
	});
});
