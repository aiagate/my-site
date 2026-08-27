import fs from "node:fs";
import path from "node:path";

import { formatInTimeZone } from "date-fns-tz";
import { marked } from "marked";
import { ZodError, z } from "zod";
import { parse } from "zod-matter";
import { escapeHtml, sanitizeMarkdownHtml } from "./html.ts";
import {
	SITE_DESCRIPTION,
	SITE_NAME,
	SITE_TIME_ZONE,
	SITE_URL,
} from "./site.ts";
import {
	type Post,
	postFilenameSchema,
	postFrontMatterSchema,
	type SitemapEntry,
} from "./types.ts";

const CONTENT_DIR = "content/blog";
const OUTPUT_DIR = "dist";
const BLOG_OUTPUT_DIR = "dist/blog";
const articleTemplate = fs.readFileSync("templates/article.html", "utf8");
const headerTemplate = fs.readFileSync("templates/header.html", "utf8");
const indexTemplate = fs.readFileSync("templates/index.html", "utf8");

function cleanOutput() {
	fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
	fs.mkdirSync(BLOG_OUTPUT_DIR, { recursive: true });
}

function parseFrontMatter<T extends z.ZodType>(
	source: string,
	schema: T,
	filePath: string,
) {
	try {
		return parse(source, schema);
	} catch (error) {
		if (error instanceof ZodError) {
			throw new Error(
				`${filePath} の front matter が不正です。\n${z.prettifyError(error)}`,
			);
		}

		throw error;
	}
}

function loadPosts(): Post[] {
	return fs
		.readdirSync(CONTENT_DIR)
		.filter((file) => file.endsWith(".md"))
		.map((file) => loadPost(file));
}

function loadPost(file): Post {
	const filePath = path.join(CONTENT_DIR, file);
	const fileName = postFilenameSchema.safeParse(file);

	if (!fileName.success) {
		throw new Error(
			`${filePath} のファイル名が不正です。\n${z.prettifyError(fileName.error)}`,
		);
	}

	const source = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");

	const { data, content } = parseFrontMatter(
		source,
		postFrontMatterSchema,
		filePath,
	);

	return {
		slug: fileName.data.slug,
		...data,
		content: content,
	};
}

function getPostPath(post: Post): string {
	return `/blog/${post.slug}/`;
}

function getPostMarkdownPath(post: Post): string {
	return `${getPostPath(post)}index.md`;
}

function getPostSitemapEntry(post: Post): SitemapEntry {
	return {
		pathname: getPostPath(post),
		lastModified: post.updatedAt ?? post.createdAt,
	};
}

async function buildArticle(post: Post): Promise<void> {
	const content = sanitizeMarkdownHtml(
		await marked(post.content, { breaks: true }),
	);

	const html = articleTemplate
		.replace("{{ siteHeader }}", headerTemplate)
		.replace("{{ slug }}", escapeHtml(post.slug))
		.replaceAll("{{ title }}", escapeHtml(post.title))
		.replace("{{ markdownPath }}", getPostMarkdownPath(post))
		.replaceAll(
			"{{ createdAt }}",
			formatInTimeZone(post.createdAt, SITE_TIME_ZONE, "yyyy/MM/dd"),
		)
		.replaceAll("{{ createdAtIso }}", post.createdAt.toISOString())
		.replaceAll("{{ description }}", escapeHtml(post.description))
		.replace("{{ content }}", content);

	const outputDir = path.join(BLOG_OUTPUT_DIR, post.slug);

	fs.mkdirSync(outputDir, { recursive: true });
	fs.writeFileSync(path.join(outputDir, "index.html"), html);
	fs.writeFileSync(path.join(outputDir, "index.md"), post.content);
}

function getLastModified(posts: Post[]): Date | undefined {
	return posts
		.map((post) => post.updatedAt ?? post.createdAt)
		.reduce<Date | undefined>(
			(latest, date) => (!latest || date > latest ? date : latest),
			undefined,
		);
}

function buildIndex(posts: Post[]): void {
	const postsHtml = posts
		.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		.map(renderPostListItem)
		.join("");

	const html = indexTemplate
		.replace("{{ siteHeader }}", headerTemplate)
		.replace("{{ posts }}", postsHtml);

	fs.writeFileSync(path.join(OUTPUT_DIR, "index.html"), html);
}

function buildPostSlugs(posts: Post[]): void {
	fs.writeFileSync(
		path.join(OUTPUT_DIR, "post-slugs.json"),
		`${JSON.stringify(posts.map((post) => post.slug))}\n`,
	);
}

function buildLlmsTxt(posts: Post[]): void {
	const blog = posts
		.toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
		.map(
			(post) =>
				`- [${post.title}](${getPostMarkdownPath(post)}): ${post.description} (${formatInTimeZone(post.createdAt, SITE_TIME_ZONE, "yyyy-MM-dd")})`,
		)
		.join("\n");

	const llmsTxt = `# ${SITE_NAME}
> ${SITE_DESCRIPTION}

## Blog
${blog}
`;

	fs.writeFileSync(path.join(OUTPUT_DIR, "llms.txt"), llmsTxt);
}

function renderPostListItem(post: Post) {
	return `
    <li>
      <a href="${getPostPath(post)}">
        ${escapeHtml(post.title)}
      </a>
		<time datetime="${post.createdAt.toISOString()}">
		${formatInTimeZone(post.createdAt, SITE_TIME_ZONE, "yyyy/MM/dd HH:mm")}
      </time>
    </li>
  `;
}

function copyPublic() {
	fs.cpSync("public", OUTPUT_DIR, { recursive: true });
}

function escapeXmlText(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

function xmlElement(name: string, value: string): string {
	return `<${name}>${escapeXmlText(value)}</${name}>`;
}

function renderSitemapEntry(entry: SitemapEntry): string {
	const url = new URL(entry.pathname, SITE_URL).href;
	const elements = [xmlElement("loc", url)];

	if (entry.lastModified) {
		const lastModified = formatInTimeZone(
			entry.lastModified,
			"UTC",
			"yyyy-MM-dd'T'HH:mm'Z'",
		);

		elements.push(xmlElement("lastmod", lastModified));
	}

	return `  <url>
${elements.map((element) => `    ${element}`).join("\n")}
  </url>`;
}

function buildSitemap(entries: SitemapEntry[]) {
	const urls = entries.map(renderSitemapEntry).join("\n");

	const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

	fs.writeFileSync(path.join(OUTPUT_DIR, "sitemap.xml"), sitemap);
}

function getSitemapEntries(posts: Post[]): SitemapEntry[] {
	return [
		{
			pathname: "/",
			lastModified: getLastModified(posts),
		},
		...posts.map(getPostSitemapEntry),
	];
}

async function main() {
	cleanOutput();

	const posts = loadPosts();

	for (const post of posts) {
		await buildArticle(post);
	}

	buildIndex(posts);
	buildPostSlugs(posts);
	buildLlmsTxt(posts);
	buildSitemap(getSitemapEntries(posts));
	copyPublic();

	console.log("Build complete.");
}

await main();
