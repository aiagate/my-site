import { type Context, Hono } from "hono";
import { getLikeCount, incrementLike } from "./likes.ts";
import { isPublishedPost } from "./published-posts.ts";

export type Env = {
	ASSETS: Fetcher;
	LIKE_RATE_LIMIT: RateLimit;
	LIKES: D1Database;
};

const postSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const app = new Hono<{ Bindings: Env }>();

function json(
	c: Context<{ Bindings: Env }>,
	body: unknown,
	status: 403 | 404 | 405 | 429,
) {
	c.header("Cache-Control", "no-store");
	return c.json(body, status);
}

async function isPublishedSlug(c: Context<{ Bindings: Env }>, slug: string) {
	return (
		postSlugPattern.test(slug) &&
		(await isPublishedPost(c.env.ASSETS, c.req.raw, slug))
	);
}

app.get("/api/likes/:slug", async (c) => {
	const slug = c.req.param("slug");

	if (!(await isPublishedSlug(c, slug))) {
		return json(c, { error: "Article not found" }, 404);
	}

	const count = await getLikeCount(c.env.LIKES, slug);
	c.header("Cache-Control", "no-store");
	return c.json({ count });
});

app.post("/api/likes/:slug", async (c) => {
	const slug = c.req.param("slug");
	const origin = new URL(c.req.url).origin;

	if (c.req.header("Origin") !== origin) {
		return json(c, { error: "Invalid origin" }, 403);
	}

	if (!(await isPublishedSlug(c, slug))) {
		return json(c, { error: "Article not found" }, 404);
	}

	const clientIp = c.req.header("CF-Connecting-IP") ?? "unknown";
	const { success } = await c.env.LIKE_RATE_LIMIT.limit({ key: clientIp });

	if (!success) {
		return json(c, { error: "Too many requests" }, 429);
	}

	const count = await incrementLike(c.env.LIKES, slug);
	c.header("Cache-Control", "no-store");
	return c.json({ count });
});

app.all("/api/likes/:slug", (c) =>
	json(c, { error: "Method not allowed" }, 405),
);

app.notFound((c) => c.env.ASSETS.fetch(c.req.raw));

export { app };
