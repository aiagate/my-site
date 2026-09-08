import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { postFilenameSchema, postSlugSchema } from "./types.ts";

const CONTENT_DIR = "content/blog";
const postTemplate = fs.readFileSync("templates/post.md", "utf8");

const newPostInputSchema = z.object({
	slug: postSlugSchema,
	title: z.string().trim().min(1, "記事タイトルを指定してください。"),
});

function formatUtcFilenamePrefix(date: Date) {
	const [datePart, timePart] = date.toISOString().split("T");

	return `${datePart.replaceAll("-", "")}-${timePart.slice(0, 5).replace(":", "")}`;
}

function findExistingSlug(slug: string): string | undefined {
	if (!fs.existsSync(CONTENT_DIR)) {
		return undefined;
	}

	for (const file of fs.readdirSync(CONTENT_DIR)) {
		const parsed = postFilenameSchema.safeParse(file);

		if (parsed.success && parsed.data.slug === slug) {
			return file;
		}
	}

	return undefined;
}

const [slug, ...titleParts] = process.argv.slice(2);
const input = newPostInputSchema.safeParse({
	slug,
	title: titleParts.join(" "),
});

if (!input.success) {
	console.error('使い方: pnpm new:post <slug> "記事タイトル"');
	console.error(z.prettifyError(input.error));
	process.exitCode = 1;
} else {
	const now = new Date();
	const createdAt = now.toISOString();
	const prefix = formatUtcFilenamePrefix(now);
	const fileName = `${prefix}--${input.data.slug}.md`;
	postFilenameSchema.parse(fileName);
	const filePath = path.join(CONTENT_DIR, fileName);
	const existingSlugFile = findExistingSlug(input.data.slug);

	if (fs.existsSync(filePath)) {
		console.error(`記事がすでに存在します: ${filePath}`);
		process.exitCode = 1;
	} else if (existingSlugFile) {
		console.error(
			`同じslugの記事がすでに存在します: ${path.join(CONTENT_DIR, existingSlugFile)}`,
		);
		process.exitCode = 1;
	} else {
		const source = postTemplate
			.replaceAll("{{ createdAt }}", createdAt)
			.replaceAll("{{ title }}", JSON.stringify(input.data.title));

		fs.mkdirSync(CONTENT_DIR, { recursive: true });
		fs.writeFileSync(filePath, source, "utf8");

		console.log(`記事を作成しました: ${filePath}`);
	}
}
