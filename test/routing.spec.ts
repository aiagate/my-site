import fs from "node:fs";
import path from "node:path";
import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localRuntime } from "../tools/local-runtime.ts";

let runtime: Miniflare;
beforeAll(async () => {
	runtime = await localRuntime();
});
afterAll(async () => {
	await runtime?.dispose();
});

describe("本番ビルドの分離と配信経路", () => {
	it("静的側には実行コードがなくAPI側には記事を含めない", () => {
		const output = "site/.cloudflare/output/v0/workers/default";
		const config = JSON.parse(
			fs.readFileSync(`${output}/worker.config.json`, "utf8"),
		);
		expect(config.name).toBe("my-site");
		expect(config.manifest).toBeUndefined();
		expect(fs.existsSync(`${output}/bundle`)).toBe(false);
		const apiOutput = "api/.cloudflare/output/v0/workers/default";
		expect(fs.readdirSync(`${apiOutput}/assets`)).toEqual(["post-slugs.json"]);
		expect(fs.readFileSync(`${apiOutput}/assets/post-slugs.json`)).toEqual(
			fs.readFileSync(`${output}/assets/post-slugs.json`),
		);
	});

	for (const origin of ["https://shimae.net", "https://www.shimae.net"]) {
		describe(origin, () => {
			for (const pathname of [
				"/",
				"/blog/hello/",
				"/blog/hello",
				"/style.css",
				"/robots.txt",
				"/sitemap.xml",
				"/llms.txt",
				"/blog/hello/index.md",
				"/phpinfo.php",
				"/missing",
				"/api/unknown",
				"/api/likes",
				"/API/likes/hello",
			]) {
				for (const method of ["GET", "HEAD", "POST", "OPTIONS"]) {
					it(`${method} ${pathname} は期待した静的応答を返す`, async () => {
						const missing = [
							"/phpinfo.php",
							"/missing",
							"/api/unknown",
							"/api/likes",
							"/API/likes/hello",
						].includes(pathname);
						const expected = missing
							? 404
							: ["POST", "OPTIONS"].includes(method)
								? 405
								: pathname === "/blog/hello"
									? 307
									: 200;
						const response = await runtime.dispatchFetch(
							`${origin}${pathname}`,
							{ method, redirect: "manual" },
						);
						expect(response.status).toBe(expected);
						if (method === "HEAD") expect(await response.text()).toBe("");
						if (expected === 307)
							expect(response.headers.get("Location")).toBe("/blog/hello/");
						if (expected === 200) {
							expect(response.headers.get("Content-Type")).not.toBeNull();
							expect(response.headers.get("ETag")).not.toBeNull();
							expect(response.headers.get("Cache-Control")).toBe(
								"public, max-age=0, must-revalidate",
							);
						}
					});
				}
			}

			it("全公開アセットの内容を変えずに配信する", async () => {
				for (const file of fs.readdirSync("dist", { recursive: true })) {
					const filename = String(file);
					const source = path.join("dist", filename);
					if (!fs.statSync(source).isFile() || filename === "_headers")
						continue;
					const pathname = filename.endsWith("index.html")
						? `/${filename.slice(0, -"index.html".length)}`
						: `/${filename}`;
					const response = await runtime.dispatchFetch(`${origin}${pathname}`);
					expect(response.status, pathname).toBe(200);
					expect(Buffer.from(await response.arrayBuffer()), pathname).toEqual(
						fs.readFileSync(source),
					);
				}
			});

			for (const pathname of ["/phpinfo.php", "/missing", "/api/unknown"]) {
				it(`${pathname} はnavigateの有無にかかわらず404`, async () => {
					for (const headers of [{}, { "Sec-Fetch-Mode": "navigate" }]) {
						const response = await runtime.dispatchFetch(
							`${origin}${pathname}`,
							{ headers },
						);
						expect(response.status).toBe(404);
					}
				});
			}

			it("通常GET・画面遷移・HEADのAPI応答とキャッシュを維持する", async () => {
				for (const method of ["GET", "HEAD"]) {
					for (const headers of [{}, { "Sec-Fetch-Mode": "navigate" }]) {
						const response = await runtime.dispatchFetch(
							`${origin}/api/likes/hello?check=1`,
							{ method, headers },
						);
						expect(response.status).toBe(200);
						expect(response.headers.get("Cache-Control")).toBe("no-store");
						expect(response.headers.get("Content-Type")).toContain(
							"application/json",
						);
						expect(
							response.headers.get("Access-Control-Allow-Origin"),
						).toBeNull();
						if (method === "HEAD") expect(await response.text()).toBe("");
						else expect(await response.json()).toEqual({ count: 0 });
					}
				}
			});

			for (const pathname of [
				"/api/likes/",
				"/api/likes/missing",
				"/api/likes/hello/extra",
				"/api/likes/hello/",
				"/api/likes//hello",
				"/api/likes/hello%2Fextra",
				"/api/likes/HELLO",
			]) {
				it(`${pathname} はJSON404で静的ページを配信しない`, async () => {
					const response = await runtime.dispatchFetch(`${origin}${pathname}`, {
						headers: { "Sec-Fetch-Mode": "navigate" },
					});
					expect(response.status).toBe(404);
					expect(response.headers.get("Content-Type")).toContain(
						"application/json",
					);
					expect(response.headers.get("Cache-Control")).toBe("no-store");
				});
			}
		});
	}
});
