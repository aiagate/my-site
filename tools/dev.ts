import { localRuntime } from "./local-runtime.ts";

const runtime = await localRuntime(true);
console.log(`Local site and likes API: ${await runtime.ready}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, async () => {
		await runtime.dispose();
		process.exit(0);
	});
}
