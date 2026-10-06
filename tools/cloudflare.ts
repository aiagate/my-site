// The token stays in process memory and goes only through the standard proxy
// to api.cloudflare.com. Never print headers, response bodies, or credentials.
export async function cloudflareGet<T>(path: string): Promise<T> {
	const token = process.env.CLOUDFLARE_API_TOKEN;
	if (!token) throw new Error("CLOUDFLARE_API_TOKEN is not supplied");
	const target = new URL(`https://api.cloudflare.com/client/v4${path}`);
	if (target.origin !== "https://api.cloudflare.com") {
		throw new Error("Invalid Cloudflare API origin");
	}
	const response = await fetch(target, {
		headers: { Authorization: `Bearer ${token}` },
		redirect: "error",
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) {
		throw new Error(
			`Cloudflare metadata read failed (HTTP ${response.status})`,
		);
	}
	const data = (await response.json()) as { success?: boolean; result: T };
	if (data.success !== true) throw new Error("Cloudflare metadata read failed");
	return data.result;
}

export function accountPath() {
	const account = process.env.CLOUDFLARE_ACCOUNT_ID;
	if (!account || !/^[a-z0-9]+$/i.test(account)) {
		throw new Error("A valid CLOUDFLARE_ACCOUNT_ID is required");
	}
	return `/accounts/${account}`;
}

export type WorkerSettings = {
	bindings: {
		type: string;
		name: string;
		id?: string;
		namespace_id?: string | number;
		simple?: { limit: number; period: number };
	}[];
};
