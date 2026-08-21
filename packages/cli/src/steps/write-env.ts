import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ENV_BLOCK_MARKER = "# --- Emito ---";

/**
 * Generates a fresh HS256 signing secret for `EMITO_JWT_SECRET`.
 *
 * Deliberately NOT written into `.env.example` — that file is meant to be
 * committed. The caller prints the value so the user can paste it into their
 * real (git-ignored) `.env`.
 */
export function generateJwtSecret(): string {
	return randomBytes(32).toString("hex");
}

/**
 * Generates a fresh value for `EMITO_API_KEY` (gates the admin-only
 * `x-emito-admin-key` endpoints — see @emito/server). Unlike RESEND_API_KEY/
 * SMSAPI_ACCESS_TOKEN, this isn't issued by a third party — any sufficiently
 * random string works, so there's no reason to make the user invent one by
 * hand. Deliberately NOT written into `.env.example`, same as the JWT secret.
 */
export function generateApiKey(): string {
	return randomBytes(24).toString("hex");
}

export function envTemplateBlock(): string {
	return `
${ENV_BLOCK_MARKER}
EMITO_JWT_SECRET=
EMITO_API_KEY=
RESEND_API_KEY=
EMITO_EMAIL_FROM=
SMSAPI_ACCESS_TOKEN=
EMITO_SMS_FROM=
`;
}

/**
 * Idempotent: if `.env.example` already contains the Emito block (e.g. from a
 * prior `init` run that failed at a later step), this is a no-op rather than
 * appending a duplicate block.
 */
export function appendEnvExample(cwd: string, block: string): void {
	const path = join(cwd, ".env.example");
	if (existsSync(path)) {
		const existing = readFileSync(path, "utf8");
		if (existing.includes(ENV_BLOCK_MARKER)) {
			return;
		}
		appendFileSync(path, block);
	} else {
		writeFileSync(path, block.trimStart());
	}
}
