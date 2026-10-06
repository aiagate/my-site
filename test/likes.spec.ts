import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const origin = "https://shimae.test";

function like(slug: string, requestOrigin = origin, clientIp?: string) {
	const headers = new Headers({ Origin: requestOrigin });

	if (clientIp) {
		headers.set("CF-Connecting-IP", clientIp);
	}

	return exports.default.fetch(
		new Request(`${origin}/api/likes/${slug}`, {
			method: "POST",
			headers,
		}),
	);
}

function getLikeCount(slug: string) {
	return exports.default.fetch(new Request(`${origin}/api/likes/${slug}`));
}

describe("記事いいね API", () => {
	it("連打ごとに累積数を増やす", async () => {
		const first = await like("hello");
		const second = await like("hello");

		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ count: 1 });
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({ count: 2 });
	});

	it("ページ再読み込み用に現在の累積数を返す", async () => {
		await like("hello");
		await like("hello");

		const response = await getLikeCount("hello");

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ count: 2 });
	});

	it("公開されていない記事は更新しない", async () => {
		const response = await like("not-a-post");

		expect(response.status).toBe(404);
	});

	it("他Originからの更新を拒否する", async () => {
		const response = await like("hello", "https://example.test");

		expect(response.status).toBe(403);
	});

	it("同じ送信元からの連打を制限する", async () => {
		const clientIp = "203.0.113.42";

		for (let attempt = 0; attempt < 30; attempt++) {
			expect((await like("hello", origin, clientIp)).status).toBe(200);
		}

		const response = await like("hello", origin, clientIp);
		const count = await getLikeCount("hello");

		expect(response.status).toBe(429);
		expect(await response.json()).toEqual({ error: "Too many requests" });
		expect(count.status).toBe(200);
		expect(await count.json()).toEqual({ count: 30 });
	});

	it("HEADはGETと同じステータスで本文を返さない", async () => {
		const response = await exports.default.fetch(
			new Request(`${origin}/api/likes/hello`, { method: "HEAD" }),
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("");
	});

	it("APIへの画面遷移でもJSONを返す", async () => {
		const response = await exports.default.fetch(
			new Request(`${origin}/api/likes/hello`, {
				headers: { "Sec-Fetch-Mode": "navigate" },
			}),
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ count: 0 });
	});

	it("CORSプリフライトは許可しない", async () => {
		const response = await exports.default.fetch(
			new Request(`${origin}/api/likes/hello`, {
				method: "OPTIONS",
				headers: {
					Origin: "https://example.test",
					"Access-Control-Request-Method": "POST",
				},
			}),
		);

		expect(response.status).toBe(405);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
		expect(await response.json()).toEqual({ error: "Method not allowed" });
	});

	it("OriginがないPOSTを拒否する", async () => {
		const response = await exports.default.fetch(
			new Request(`${origin}/api/likes/hello`, { method: "POST" }),
		);

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Invalid origin" });
	});

	it("未知APIを404として返す", async () => {
		const response = await exports.default.fetch(
			new Request(`${origin}/api/unknown`),
		);

		expect(response.status).toBe(404);
	});

	it("未対応のHTTPメソッドを拒否する", async () => {
		const response = await exports.default.fetch(
			new Request(`${origin}/api/likes/hello`, { method: "PUT" }),
		);

		expect(response.status).toBe(405);
	});
});
