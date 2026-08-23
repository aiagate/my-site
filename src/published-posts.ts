export async function isPublishedPost(
	assets: Fetcher,
	request: Request,
	slug: string,
): Promise<boolean> {
	const manifestUrl = new URL("/post-slugs.json", request.url);
	const response = await assets.fetch(new Request(manifestUrl));

	if (!response.ok) {
		return false;
	}

	const slugs: unknown = await response.json();
	return Array.isArray(slugs) && slugs.includes(slug);
}
