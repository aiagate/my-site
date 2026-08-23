export async function incrementLike(
	db: D1Database,
	slug: string,
): Promise<number> {
	const result = await db
		.prepare(
			`INSERT INTO article_likes (slug, count)
       VALUES (?, 1)
       ON CONFLICT(slug) DO UPDATE SET count = count + 1
       RETURNING count`,
		)
		.bind(slug)
		.first<{ count: number }>();

	return result?.count ?? 0;
}

export async function getLikeCount(
	db: D1Database,
	slug: string,
): Promise<number> {
	const result = await db
		.prepare("SELECT count FROM article_likes WHERE slug = ?")
		.bind(slug)
		.first<{ count: number }>();

	return result?.count ?? 0;
}
