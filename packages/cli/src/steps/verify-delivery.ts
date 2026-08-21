// Headless delivery proof: send one notification and poll the inbox until it shows up.
//
// This is an INTERNAL BUILDING BLOCK, not a user-facing v1 feature. It is
// currently exercised only by the end-to-end test suite
// (`src/__tests__/e2e/init.e2e.test.ts`), which mounts the generated glue itself
// and then runs this handshake against a live server.
//
// `emito init` deliberately does not call it, and that is not an oversight: the
// CLI's job stops at *generating* `emito.config.ts` / `emito.mount.ts`. It never
// mounts them into the consumer's entrypoint, because it cannot safely infer
// arbitrary existing code structure. So at the moment `init`
// finishes there is nothing running to verify against — `init` correctly ends with
// `"manual-mount-required"` instead. Only the agent skill performs the mount,
// which is why verification belongs downstream of that step rather than inside
// `init`.

export interface VerifyDeps {
	send(event: string, subscriberId: string, payload: Record<string, unknown>): Promise<unknown>;
	listInbox(subscriberId: string): Promise<Array<{ event: string }>>;
}

const VERIFY_SUBSCRIBER_ID = "cli-verify";
const MAX_ATTEMPTS = 5;
const POLL_INTERVAL_MS = 200;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyDelivery(deps: VerifyDeps): Promise<boolean> {
	await deps.send("welcome.sent", VERIFY_SUBSCRIBER_ID, { source: "emito-cli-verify" });

	for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
		const inbox = await deps.listInbox(VERIFY_SUBSCRIBER_ID);
		if (inbox.some((entry) => entry.event === "welcome.sent")) {
			return true;
		}
		await sleep(POLL_INTERVAL_MS);
	}

	return false;
}
