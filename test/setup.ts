import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach } from "vitest";

beforeAll(async () => {
	await applyD1Migrations(env.LIKES, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
	await env.LIKES.prepare("DELETE FROM article_likes").run();
});
