import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://shimae.test";

describe("静的アセット", () => {
	it("一覧と記事に発見用のメタデータを出力する", async () => {
		const [home, article] = await Promise.all([
			exports.default.fetch(new Request(`${origin}/`)),
			exports.default.fetch(new Request(`${origin}/blog/hello/`)),
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
			exports.default.fetch(new Request(`${origin}/llms.txt`)),
			exports.default.fetch(new Request(`${origin}/blog/hello/index.md`)),
		]);

		expect(llmsTxt.headers.get("Content-Type")).toBe(
			"text/plain; charset=utf-8",
		);
		expect(markdown.headers.get("Content-Type")).toBe(
			"text/markdown; charset=utf-8",
		);
	});
});
