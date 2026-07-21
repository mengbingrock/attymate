import { createInterface, type Interface } from "node:readline/promises";

let rl: Interface | undefined;
let chain: Promise<unknown> = Promise.resolve();

function getInterface(): Interface {
	if (!rl) {
		rl = createInterface({ input: process.stdin, output: process.stdout });
	}
	return rl;
}

/**
 * Ask the human operator a question on the terminal. Calls are serialized so
 * concurrent tools (approvals, ask_lawyer) never interleave their prompts.
 */
export function askHuman(question: string): Promise<string> {
	const next = chain.then(() => getInterface().question(question));
	chain = next.catch(() => undefined);
	return next;
}

export function closeHumanIO(): void {
	rl?.close();
	rl = undefined;
}

export function logLine(message: string): void {
	process.stdout.write(`${message}\n`);
}
