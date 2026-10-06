import fs from "node:fs";
import {
	accountPath,
	cloudflareGet,
	type WorkerSettings,
} from "./cloudflare.ts";

const current = await cloudflareGet<WorkerSettings>(
	`${accountPath()}/workers/scripts/my-site/settings`,
);
if (current.bindings.some((binding) => binding.name === "LIKES")) {
	const zones = await cloudflareGet<{ id: string; account: { id: string } }[]>(
		"/zones?name=shimae.net",
	);
	if (
		zones.length !== 1 ||
		`/accounts/${zones[0].account.id}` !== accountPath()
	) {
		throw new Error("Cannot identify the initial split's target zone");
	}
	const routes = await cloudflareGet<unknown[]>(
		`/zones/${zones[0].id}/workers/routes`,
	);
	if (routes.length !== 0) {
		throw new Error(
			"Initial split requires the verified empty Worker Routes state",
		);
	}
	// Initial split must not change publication state while the old site serves.
	const candidate: unknown = JSON.parse(
		fs.readFileSync("dist/post-slugs.json", "utf8"),
	);
	if (
		!Array.isArray(candidate) ||
		!candidate.every((slug) => typeof slug === "string")
	) {
		throw new Error("Invalid candidate published-post manifest");
	}
	for (const origin of ["https://shimae.net", "https://www.shimae.net"]) {
		const response = await fetch(`${origin}/post-slugs.json`, {
			redirect: "error",
			signal: AbortSignal.timeout(15_000),
		});
		if (!response.ok)
			throw new Error("Cannot verify current published articles");
		const published: unknown = await response.json();
		if (
			!Array.isArray(published) ||
			!published.every((slug) => typeof slug === "string") ||
			JSON.stringify([...published].sort()) !==
				JSON.stringify([...candidate].sort())
		) {
			throw new Error(
				"Initial split must use the currently published article set",
			);
		}
	}
	console.log("Initial split: both published manifests match the candidate");
}
