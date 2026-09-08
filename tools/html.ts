import sanitizeHtml from "sanitize-html";

const markdownSanitizeOptions = {
	allowedTags: [...sanitizeHtml.defaults.allowedTags, "img"],
	allowedAttributes: {
		a: ["href", "title"],
		code: ["class"],
		img: ["src", "srcset", "alt", "title", "width", "height", "loading"],
	},
	allowedSchemes: ["http", "https", "mailto"],
	allowProtocolRelative: false,
};

/** Escapes untrusted text for HTML text and quoted attribute contexts. */
export function escapeHtml(value: unknown): string {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

/** Removes executable markup and unsafe URL schemes from rendered Markdown. */
export function sanitizeMarkdownHtml(value: string): string {
	return sanitizeHtml(value, markdownSanitizeOptions);
}
