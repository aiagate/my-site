import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localRuntime } from "../tools/local-runtime.ts";

const origin = "https://shimae.test";
let runtime: Miniflare;

beforeAll(async () => {
	runtime = await localRuntime();
});
afterAll(async () => {
	await runtime?.dispose();
});

describe("静的アセット", () => {
	it("公開記事のslugを重複なくマニフェストに出力する", async () => {
		const response = await runtime.dispatchFetch(`${origin}/post-slugs.json`);
		const slugs = (await response.json()) as string[];

		expect(response.status).toBe(200);
		expect(new Set(slugs).size).toBe(slugs.length);
		expect(slugs.toSorted()).toEqual([
			"ai-ronpa-kaikan-driven-development",
			"hello",
			"what-role-for-me",
		]);
	});

	it("下書きは記事・SEO・公開manifest・いいねAPIに出力しない", async () => {
		const slug = "anonymous-likes-with-workers-and-d1";
		for (const pathname of [
			"/",
			"/sitemap.xml",
			"/llms.txt",
			"/post-slugs.json",
		]) {
			const response = await runtime.dispatchFetch(`${origin}${pathname}`);
			expect(response.status).toBe(200);
			expect(await response.text()).not.toContain(slug);
		}
		for (const pathname of [`/blog/${slug}/`, `/blog/${slug}/index.md`]) {
			const response = await runtime.dispatchFetch(`${origin}${pathname}`);
			expect(response.status).toBe(404);
		}
		for (const method of ["GET", "HEAD", "POST"]) {
			const response = await runtime.dispatchFetch(
				`${origin}/api/likes/${slug}`,
				{
					method,
					headers: { Origin: origin },
				},
			);
			expect(response.status).toBe(404);
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
	});

	it("一覧と記事に発見用のメタデータを出力する", async () => {
		const [home, article] = await Promise.all([
			runtime.dispatchFetch(`${origin}/`),
			runtime.dispatchFetch(`${origin}/blog/hello/`),
		]);

		expect(home.status).toBe(200);
		expect(await home.text()).toContain(
			'<link rel="canonical" href="https://shimae.net/">',
		);
		expect(await article.text()).toContain(
			'<meta property="og:type" content="article">',
		);
	});

	it("Markdownとllms.txtをUTF-8として配信する", async () => {
		const [llmsTxt, markdown] = await Promise.all([
			runtime.dispatchFetch(`${origin}/llms.txt`),
			runtime.dispatchFetch(`${origin}/blog/hello/index.md`),
		]);

		expect(llmsTxt.headers.get("Content-Type")).toBe(
			"text/plain; charset=utf-8",
		);
		expect(markdown.headers.get("Content-Type")).toBe(
			"text/markdown; charset=utf-8",
		);
	});
});
