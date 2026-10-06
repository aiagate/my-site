import fs from "node:fs";
import config from "../api/cloudflare.config.ts";
import {
	accountPath,
	cloudflareGet,
	type WorkerSettings,
} from "./cloudflare.ts";

// HTTP success could come from the old combined Worker. Require the actual
// Routes and an active new API deployment before changing the static Worker.
const zones = await cloudflareGet<{ id: string; account: { id: string } }[]>(
	"/zones?name=shimae.net",
);
if (
	zones.length !== 1 ||
	`/accounts/${zones[0].account.id}` !== accountPath()
) {
	throw new Error("Cannot identify the target zone in the supplied account");
}
const routes = await cloudflareGet<{ pattern: string; script: string }[]>(
	`/zones/${zones[0].id}/workers/routes`,
);
if (routes.length !== config.worker.triggers.length) {
	throw new Error(
		"Unexpected Worker Routes require review before static cutover",
	);
}
for (const trigger of config.worker.triggers) {
	if (
		!routes.some(
			(route) =>
				route.pattern === trigger.pattern &&
				route.script === config.worker.name,
		)
	) {
		throw new Error("Both API Routes must point to the new API Worker");
	}
}
const scriptPath = `${accountPath()}/workers/scripts/${config.worker.name}`;
const deployments = await cloudflareGet<{
	deployments: { versions: { version_id: string; percentage: number }[] }[];
}>(`${scriptPath}/deployments`);
const active = deployments.deployments[0]?.versions;
if (
	active?.length !== 1 ||
	active[0].percentage !== 100 ||
	!active[0].version_id
) {
	throw new Error("Cannot verify the API Worker's active version");
}
const settings = await cloudflareGet<WorkerSettings>(`${scriptPath}/settings`);
const db = settings.bindings.find((binding) => binding.name === "LIKES");
const rate = settings.bindings.find(
	(binding) => binding.name === "LIKE_RATE_LIMIT",
);
if (
	db?.type !== "d1" ||
	db.id !== config.worker.env.LIKES.id ||
	rate?.type !== "ratelimit" ||
	String(rate.namespace_id) !== config.worker.env.LIKE_RATE_LIMIT.namespace ||
	rate.simple?.limit !== config.worker.env.LIKE_RATE_LIMIT.simple.limit ||
	rate.simple?.period !== config.worker.env.LIKE_RATE_LIMIT.simple.period
) {
	throw new Error(
		"API D1 and rate-limit bindings do not match the verified configuration",
	);
}
const subdomain = await cloudflareGet<{
	enabled: boolean;
	previews_enabled: boolean;
}>(`${scriptPath}/subdomain`);
if (subdomain.enabled !== false || subdomain.previews_enabled !== false) {
	throw new Error("The API Worker's alternative public URLs must be disabled");
}
console.log(
	`API Routes and bindings verified; active version: ${active[0].version_id}`,
);

const slugs = JSON.parse(fs.readFileSync("dist/post-slugs.json", "utf8"));
if (!Array.isArray(slugs) || typeof slugs[0] !== "string") {
	throw new Error(
		"No published article is available for the read-only API check",
	);
}

// No authentication headers and no likes writes: these are public read checks.
for (const origin of ["https://shimae.net", "https://www.shimae.net"]) {
	for (const method of ["GET", "HEAD"]) {
		const response = await fetch(`${origin}/api/likes/${slugs[0]}`, {
			method,
			headers: { "Sec-Fetch-Mode": "navigate" },
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (
			response.status !== 200 ||
			!response.headers.get("Content-Type")?.startsWith("application/json") ||
			response.headers.get("Cache-Control") !== "no-store" ||
			response.headers.has("Access-Control-Allow-Origin")
		) {
			throw new Error(
				`API check failed: ${origin} ${method} ${response.status}`,
			);
		}
		if (method === "GET") {
			const body = (await response.json()) as { count?: unknown };
			if (
				typeof body.count !== "number" ||
				!Number.isSafeInteger(body.count) ||
				body.count < 0
			) {
				throw new Error(`Invalid API response: ${origin}`);
			}
		} else if ((await response.text()) !== "") {
			throw new Error(`HEAD unexpectedly returned a body: ${origin}`);
		}
	}
	console.log(`API read checks passed: ${origin}`);
}
