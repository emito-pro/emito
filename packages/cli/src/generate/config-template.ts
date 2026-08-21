import type { BackendFramework } from "../detect/framework.js";
import type { ProjectLanguage } from "../detect/language.js";

export interface GenerateOptions {
	framework: BackendFramework;
	channels: Array<"email" | "sms">;
	/** Defaults to `"ts"`. Set to `"js"` for a consumer project with no `tsconfig.json`. */
	lang?: ProjectLanguage;
}

/**
 * Indents every line of a generated block by one tab. The provider blocks are
 * interpolated *inside* `createEmitoRuntime()`'s body, so without this only the
 * first line would pick up the template literal's leading tab and every
 * following line would land flush-left inside the function.
 */
function indentBlock(block: string): string {
	return block
		.split("\n")
		.map((line) => (line === "" ? "" : `\t${line}`))
		.join("\n");
}

function emailProviderBlock(selected: boolean, isTs: boolean): string {
	// Nothing references `emailProviders` when the channel isn't selected (the
	// `channels: {...}` object only emits the `email` key conditionally), so emit
	// no declaration at all rather than an unused one.
	if (!selected) return "";
	const typeAnnotation = isTs ? ": ProviderPlugin[]" : "";
	return `const emailProviders${typeAnnotation} = [];
if (process.env.RESEND_API_KEY && process.env.EMITO_EMAIL_FROM) {
	const { createResendProvider } = await import("@emito/provider-resend");
	emailProviders.push(
		createResendProvider({ apiKey: process.env.RESEND_API_KEY, fromAddress: process.env.EMITO_EMAIL_FROM }),
	);
} else {
	emailProviders.push(createMockProvider("email", { name: "mock-email" }));
	console.log("[emito] No RESEND_API_KEY/EMITO_EMAIL_FROM — using mock email provider (console output)");
}`;
}

function smsProviderBlock(selected: boolean, isTs: boolean): string {
	// See `emailProviderBlock` — no declaration when the channel isn't selected.
	if (!selected) return "";
	const typeAnnotation = isTs ? ": ProviderPlugin[]" : "";
	return `const smsProviders${typeAnnotation} = [];
if (process.env.SMSAPI_ACCESS_TOKEN && process.env.EMITO_SMS_FROM) {
	const { createSmsapiProvider } = await import("@emito/provider-smsapi");
	smsProviders.push(
		createSmsapiProvider({ accessToken: process.env.SMSAPI_ACCESS_TOKEN, from: process.env.EMITO_SMS_FROM }),
	);
} else {
	smsProviders.push(createMockProvider("sms", { name: "mock-sms" }));
	console.log("[emito] No SMSAPI_ACCESS_TOKEN/EMITO_SMS_FROM — using mock SMS provider (console output)");
}`;
}

export function renderConfigTemplate(opts: GenerateOptions): string {
	const lang = opts.lang ?? "ts";
	const isTs = lang === "ts";
	const wantsEmail = opts.channels.includes("email");
	const wantsSms = opts.channels.includes("sms");
	const channels = ["inApp", ...(wantsEmail ? ["email"] : []), ...(wantsSms ? ["sms"] : [])];
	// `ProviderPlugin` is re-exported by `@emito/core`; importing it from
	// `@emito/types` would not resolve in the consumer's project, since only
	// `@emito/core` (not its transitive deps) is installed as a direct dependency.
	const providerPluginImport = isTs && (wantsEmail || wantsSms) ? "\n\ttype ProviderPlugin," : "";
	const channelEntries = [
		...(wantsEmail ? ["email: { providers: emailProviders },"] : []),
		...(wantsSms ? ["sms: { providers: smsProviders },"] : []),
	]
		.map((entry) => `\n\t\t\t${entry}`)
		.join("");
	const blocks = [emailProviderBlock(wantsEmail, isTs), smsProviderBlock(wantsSms, isTs)].filter(
		(block) => block !== "",
	);
	const providerBlocks = blocks.length > 0 ? `${blocks.map(indentBlock).join("\n\n")}\n\n` : "";

	const coreImport = isTs
		? `import {
	type Emito,${providerPluginImport}
	type PushTokenRepository,
	IoRedisAdapter,
	createEmito,
	createMockProvider,
} from "@emito/core";`
		: `import { IoRedisAdapter, createEmito, createMockProvider } from "@emito/core";`;

	const dbImport = isTs
		? `import {
	type DrizzleDb,
	DrizzleConsentRepository,
	DrizzleDeadLetterRepository,
	DrizzleInboxRepository,
	DrizzleIntegrationRepository,
	DrizzleNotificationRepository,
	DrizzlePreferenceRepository,
	DrizzleSubscriberRepository,
	DrizzleSubscriptionRepository,
	DrizzleSuppressionRepository,
	DrizzleWorkspaceDefaultRepository,
	createDrizzleClient,
} from "@emito/db";`
		: `import {
	DrizzleConsentRepository,
	DrizzleDeadLetterRepository,
	DrizzleInboxRepository,
	DrizzleIntegrationRepository,
	DrizzleNotificationRepository,
	DrizzlePreferenceRepository,
	DrizzleSubscriberRepository,
	DrizzleSubscriptionRepository,
	DrizzleSuppressionRepository,
	DrizzleWorkspaceDefaultRepository,
	createDrizzleClient,
} from "@emito/db";`;

	const serverTypeImportLine = isTs
		? 'import type { EmitoServerRepositories } from "@emito/server";\n'
		: "";

	const runtimeInterfaceBlock = isTs
		? `export interface EmitoRuntime {
	emito: Emito;
	repositories: EmitoServerRepositories;
	redis: IoRedisAdapter;
	db: DrizzleDb;
	cleanup: () => Promise<void>;
}

`
		: "";

	const createRuntimeReturnType = isTs ? ": Promise<EmitoRuntime>" : "";
	const repositoriesTypeAnnotation = isTs ? ": EmitoServerRepositories" : "";
	const pushTokenRepoLine = isTs
		? "{ async deactivateByToken() {} } satisfies PushTokenRepository,"
		: "{ async deactivateByToken() {} },";
	const dbClientEndExpr = isTs
		? "(db as unknown as { $client: { end: () => Promise<void> } }).$client.end()"
		: "db.$client.end()";

	return `// Generated by \`emito init\` — you own this file, edit freely.
${coreImport}
${dbImport}
${serverTypeImportLine}// Named import (not \`import Redis from "ioredis"\`): ioredis is CJS, so under
// "module": "nodenext" the default import resolves to the module namespace and is
// not constructable.
import { Redis } from "ioredis";

${runtimeInterfaceBlock}export async function createEmitoRuntime()${createRuntimeReturnType} {
	const databaseUrl = process.env.DATABASE_URL;
	const redisUrl = process.env.REDIS_URL;
	if (!databaseUrl || !redisUrl) {
		throw new Error("DATABASE_URL and REDIS_URL must be set to start Emito");
	}

	const db = createDrizzleClient(databaseUrl);
	const rawRedis = new Redis(redisUrl);
	const redis = new IoRedisAdapter(rawRedis);

	// emito.send() looks up the subscriber here (unless you pass a \`recipient\`
	// override) and throws SUBSCRIBER_NOT_FOUND if none exists — seed/upsert the
	// subscriber via subscriberRepository before your first send() in a new
	// environment, or that first test send will fail on this, not on delivery.
	const repositories${repositoriesTypeAnnotation} = {
		subscriberRepository: new DrizzleSubscriberRepository(db),
		notificationRepository: new DrizzleNotificationRepository(db),
		preferenceRepository: new DrizzlePreferenceRepository(db),
		workspaceDefaultRepository: new DrizzleWorkspaceDefaultRepository(db),
		suppressionRepository: new DrizzleSuppressionRepository(db),
		deadLetterRepository: new DrizzleDeadLetterRepository(db),
		integrationRepository: new DrizzleIntegrationRepository(db),
		inboxRepository: new DrizzleInboxRepository(db),
		consentRepository: new DrizzleConsentRepository(db),
	};

${providerBlocks}	const emito = createEmito({
		database: { url: databaseUrl },
		redis: { url: redisUrl },
		redisClient: redis,
		repositories: {
			...repositories,
			subscriptionRepository: new DrizzleSubscriptionRepository(db),
			pushTokenRepository: ${pushTokenRepoLine}
		},
		// Starter category/event — edit or extend for your own notifications.
		categories: {
			general: {
				policy: "opt_out",
				topics: {
					"welcome.sent": { channels: ${JSON.stringify(channels)}, description: "Welcome notification" },
				},
			},
		},
		events: {
			"welcome.sent": {
				category: "general",
				channels: ${JSON.stringify(channels)},
				priority: "low",
				description: "Sent once, right after emito init, to prove delivery end-to-end",
			},
		},
		channels: {
			inApp: { providers: [createMockProvider("inApp", { name: "mock-inapp" })] },${channelEntries}
		},
	});

	await emito.start();

	return {
		emito,
		repositories,
		redis,
		db,
		cleanup: async () => {
			await emito.stop();
			rawRedis.disconnect();
			await ${dbClientEndExpr};
		},
	};
}
`;
}
