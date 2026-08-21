import { confirm, isCancel, multiselect, select, text } from "@clack/prompts";
import type { BackendFramework } from "./detect/framework.js";

export interface Wizard {
	selectChannels(): Promise<Array<"email" | "sms">>;
	promptMissingEnvVar(name: string): Promise<string>;
	/** Asked only when the backend framework could not be detected — never guessed silently. */
	selectFramework(suggested: BackendFramework): Promise<BackendFramework>;
	confirmPlan(summary: string): Promise<boolean>;
}

function unwrapOrExit<T>(value: T | symbol): T {
	if (isCancel(value)) {
		console.log("Cancelled.");
		process.exit(1);
	}
	return value as T;
}

/**
 * A `Wizard` that never touches the terminal: every question resolves immediately
 * with the documented default. This is how `emito init --yes` skips the prompts —
 * by swapping the implementation behind the same interface, not by bypassing it.
 */
export function createNonInteractiveWizard(): Wizard {
	return {
		// In-app only: adding a channel means adding a provider dependency and its
		// credentials, which is not something to opt a user into unattended.
		async selectChannels() {
			return [];
		},
		// Returning "" means "still not set" — `runInit` then aborts on prerequisites
		// with a real explanation, rather than hanging on a prompt nobody can answer.
		async promptMissingEnvVar() {
			return "";
		},
		async selectFramework(suggested) {
			return suggested;
		},
		async confirmPlan() {
			return true;
		},
	};
}

export function createClackWizard(): Wizard {
	return {
		async selectChannels() {
			const answer = await multiselect({
				message: "Which delivery channels do you want, beyond in-app?",
				options: [
					{ value: "email", label: "Email (via Resend)" },
					{ value: "sms", label: "SMS (via SMSAPI)" },
				],
				required: false,
			});
			return unwrapOrExit(answer) as Array<"email" | "sms">;
		},
		async promptMissingEnvVar(name: string) {
			const answer = await text({
				message: `${name} is not set — enter it now:`,
				defaultValue: "",
			});
			return (unwrapOrExit(answer) ?? "") as string;
		},
		async selectFramework(suggested: BackendFramework) {
			const answer = await select({
				message: "Which backend adapter should Emito use? (no framework detected)",
				initialValue: suggested,
				options: [
					{ value: "node", label: "Generic Node (http.createServer / any framework)" },
					{ value: "express", label: "Express" },
					{ value: "fastify", label: "Fastify" },
					{ value: "hono", label: "Hono" },
					{ value: "nextjs", label: "Next.js (App Router route handler)" },
				],
			});
			return unwrapOrExit(answer) as BackendFramework;
		},
		async confirmPlan(summary: string) {
			const answer = await confirm({ message: `${summary}\n\nContinue?` });
			return unwrapOrExit(answer) as boolean;
		},
	};
}
