import { z } from "zod";

z.config(z.locales.ja());

export const postSlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
	error: "英小文字・数字・ハイフンのみで指定してください。",
});

export const postFilenameSchema = z
	.string()
	.regex(/^(?<prefix>\d{8}-\d{4})--(?<slug>[a-z0-9]+(?:-[a-z0-9]+)*)\.md$/, {
		error: "YYYYMMDD-HHmm--slug.md 形式にしてください。",
	})
	.transform((fileName) => {
		const [prefix, slug] = fileName.slice(0, -".md".length).split("--");

		return { prefix, slug };
	});

export const postFrontMatterSchema = z.object({
	title: z.string().min(1),
	description: z.string().min(1),
	draft: z.boolean().default(false),
	createdAt: z
		.string()
		.datetime()
		.transform((value) => new Date(value)),
	updatedAt: z
		.string()
		.datetime()
		.transform((value) => new Date(value))
		.optional(),
});

export const postSchema = postFrontMatterSchema.extend({
	slug: postSlugSchema,
	content: z.string(),
});

export type Post = z.output<typeof postSchema>;

export type SitemapEntry = {
	pathname: string;
	/** Omit this when a page has no meaningful content update date. */
	lastModified?: Date;
};
