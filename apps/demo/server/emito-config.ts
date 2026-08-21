import {
	type Emito,
	type PushTokenRepository,
	type RenderedContent,
	type TemplateResolver,
	InMemorySubscriptionRepository,
	IoRedisAdapter,
	createEmito,
	createMockProvider,
} from "@emito/core";
import {
	type DrizzleDb,
	DrizzleConsentRepository,
	DrizzleDeadLetterRepository,
	DrizzleInboxRepository,
	DrizzleIntegrationRepository,
	DrizzleNotificationRepository,
	DrizzlePreferenceRepository,
	DrizzleSubscriberRepository,
	DrizzleSuppressionRepository,
	DrizzleWorkspaceDefaultRepository,
	createDrizzleClient,
} from "@emito/db";
import type { EmitoServerRepositories } from "@emito/server";
import { createFallbackTemplate, defaultTemplates, resolveTemplateLang } from "@emito/templates";
import type { BrandTheme, Channel, EventTemplate, ProviderPlugin } from "@emito/types";
import Redis from "ioredis";

export interface DemoConfig {
	databaseUrl: string;
	redisUrl: string;
	jwtSecret: string;
	apiKey: string;
	resendApiKey?: string;
	resendFrom?: string;
}

export interface DemoEmito {
	emito: Emito;
	repositories: EmitoServerRepositories;
	redis: IoRedisAdapter;
	/**
	 * The raw Drizzle client backing every server-side repository.
	 *
	 * Exposed so the seed script writes through the SAME client the notification
	 * API reads from — one connection pool, and no second client to keep in sync.
	 */
	db: DrizzleDb;
	cleanup: () => Promise<void>;
}

// Topic keys MUST match event names — the send pipeline uses event name as topicKey for preference resolution
export const DEMO_CATEGORIES = {
	trading: {
		policy: "opt_out" as const,
		topics: {
			"order.fill": { channels: ["email", "inApp", "push", "telegram", "slack"] as Channel[], description: "Order fill notifications" },
			"price.alert": { channels: ["inApp", "push", "sms"] as Channel[], description: "Price alert notifications" },
		},
	},
	security: {
		policy: "always" as const,
		topics: {
			"security.alert": { channels: ["email", "inApp", "push", "sms", "telegram", "slack"] as Channel[], description: "Security alerts" },
		},
	},
	social: {
		policy: "opt_out" as const,
		topics: {
			"team.invite": { channels: ["email", "inApp"] as Channel[], description: "Team invitations" },
		},
	},
};

const DEMO_BRAND: BrandTheme = {
	name: "Acme Trading",
	appUrl: "http://localhost:3001",
	primaryColor: "#6366f1",
	supportEmail: "support@demo.emito.dev",
	footer: "Acme Trading Inc. — Demo Environment",
};

const EVENT_TEMPLATE_MAP: Record<string, string> = {
	"team.invite": "team.invitation",
};

function createDemoTemplateResolver(
	templates: Record<string, Record<string, EventTemplate>>,
	brand: BrandTheme,
): TemplateResolver {
	return {
		async resolve(params): Promise<RenderedContent> {
			const templateKey = EVENT_TEMPLATE_MAP[params.event] ?? params.event;
			const langMap = templates[templateKey];
			const template = langMap ? resolveTemplateLang(langMap, params.lang) : undefined;
			const resolved = template ?? createFallbackTemplate(params.event);
			const channelKey = params.channel as keyof EventTemplate;

			const ctx = { locale: params.lang, timezone: "UTC" };
			const channelFn = resolved[channelKey];

			if (!channelFn) {
				return {
					subject: typeof params.payload.subject === "string" ? params.payload.subject : params.event,
					body: typeof params.payload.body === "string" ? params.payload.body : JSON.stringify(params.payload),
				};
			}

			const result = await channelFn(params.payload, brand, ctx) as unknown as Record<string, unknown>;

			return {
				subject: typeof result.subject === "string" ? result.subject : typeof result.title === "string" ? result.title : undefined,
				body: typeof result.text === "string" ? result.text : typeof result.body === "string" ? result.body : typeof result.html === "string" ? result.html : JSON.stringify(result),
				html: typeof result.html === "string" ? result.html : undefined,
				text: typeof result.text === "string" ? result.text : undefined,
				data: typeof result.data === "object" && result.data !== null ? result.data as Record<string, unknown> : result.blocks ? { blocks: result.blocks } : undefined,
			};
		},
	};
}

export async function createDemoEmito(config: DemoConfig): Promise<DemoEmito> {
	const db = createDrizzleClient(config.databaseUrl);
	const rawRedis = new Redis(config.redisUrl);
	const redis = new IoRedisAdapter(rawRedis);

	const repositories: EmitoServerRepositories = {
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

	// --- Email (Resend) ---
	const emailProviders: ProviderPlugin[] = [];
	if (config.resendApiKey && config.resendFrom) {
		const { createResendProvider } = await import("@emito/provider-resend");
		emailProviders.push(
			createResendProvider({
				apiKey: config.resendApiKey,
				fromAddress: config.resendFrom,
			}),
		);
	} else {
		emailProviders.push(createMockProvider("email", { name: "mock-email" }));
		console.log("[emito] No RESEND_API_KEY — using mock email provider (console output)");
	}

	// --- SMS (Twilio) ---
	const smsProviders: ProviderPlugin[] = [];
	const twilioSid = process.env.TWILIO_ACCOUNT_SID;
	const twilioToken = process.env.TWILIO_AUTH_TOKEN;
	const twilioFrom = process.env.TWILIO_FROM_NUMBER;
	if (twilioSid && twilioToken && twilioFrom) {
		const { createTwilioProvider } = await import("@emito/provider-twilio");
		smsProviders.push(
			createTwilioProvider({
				accountSid: twilioSid,
				authToken: twilioToken,
				fromNumber: twilioFrom,
			}),
		);
	} else {
		smsProviders.push(createMockProvider("sms", { name: "mock-sms" }));
		console.log("[emito] No TWILIO_* env vars — using mock SMS provider (console output)");
	}

	// --- Push (FCM) ---
	const pushProviders: ProviderPlugin[] = [];
	const fcmProjectId = process.env.FCM_PROJECT_ID;
	const fcmClientEmail = process.env.FCM_CLIENT_EMAIL;
	const fcmPrivateKey = process.env.FCM_PRIVATE_KEY;
	if (fcmProjectId && fcmClientEmail && fcmPrivateKey) {
		const { createFcmProvider } = await import("@emito/provider-fcm");
		pushProviders.push(
			createFcmProvider({
				projectId: fcmProjectId,
				clientEmail: fcmClientEmail,
				privateKey: fcmPrivateKey.replace(/\\n/g, "\n"),
			}),
		);
	} else {
		pushProviders.push(createMockProvider("push", { name: "mock-push" }));
		console.log("[emito] No FCM_* env vars — using mock push provider (console output)");
	}

	// --- Slack ---
	const slackProviders: ProviderPlugin[] = [];
	if (process.env.SLACK_WEBHOOK_URL) {
		const { createSlackProvider } = await import("@emito/provider-slack");
		slackProviders.push(createSlackProvider());
	} else {
		slackProviders.push(createMockProvider("slack", { name: "mock-slack" }));
		console.log("[emito] No SLACK_WEBHOOK_URL — using mock Slack provider (console output)");
	}

	// --- Telegram ---
	const telegramProviders: ProviderPlugin[] = [];
	if (process.env.TELEGRAM_BOT_TOKEN) {
		const { createTelegramProvider } = await import("@emito/provider-telegram");
		telegramProviders.push(createTelegramProvider());
	} else {
		telegramProviders.push(createMockProvider("telegram", { name: "mock-telegram" }));
		console.log("[emito] No TELEGRAM_BOT_TOKEN — using mock Telegram provider (console output)");
	}

	// --- Startup summary ---
	const providerStatus = {
		email: emailProviders[0]!.name,
		sms: smsProviders[0]!.name,
		push: pushProviders[0]!.name,
		slack: slackProviders[0]!.name,
		telegram: telegramProviders[0]!.name,
	};
	const summary = Object.entries(providerStatus)
		.map(([k, v]) => `${k}=${v}`)
		.join(", ");
	console.log(`[emito] Providers: ${summary}`);

	const templateResolver = createDemoTemplateResolver(defaultTemplates, DEMO_BRAND);

	const emito = createEmito({
		database: { url: config.databaseUrl },
		redis: { url: config.redisUrl },
		redisClient: redis,
		templateResolver,
		brand: DEMO_BRAND,
		repositories: {
			...repositories,
			// Neither package exports a Drizzle implementation — demo doesn't exercise these features
			subscriptionRepository: new InMemorySubscriptionRepository(),
			pushTokenRepository: { async deactivateByToken() {} } satisfies PushTokenRepository,
		},
		categories: DEMO_CATEGORIES,
		events: {
			"order.fill": {
				category: "trading",
				channels: ["email", "inApp", "push", "telegram", "slack"],
				priority: "high",
				description: "Order has been filled",
			},
			"price.alert": {
				category: "trading",
				channels: ["inApp", "push", "sms"],
				priority: "high",
				description: "Price alert triggered",
			},
			"security.alert": {
				category: "security",
				channels: ["email", "inApp", "push", "sms", "telegram", "slack"],
				priority: "critical",
				bypassPreferences: true,
				description: "Security event detected",
			},
			"team.invite": {
				category: "social",
				channels: ["email", "inApp"],
				priority: "low",
				description: "Team invitation received",
			},
		},
		channels: {
			email: { providers: emailProviders },
			inApp: { providers: [createMockProvider("inApp", { name: "mock-inapp" })] },
			sms: { providers: smsProviders },
			push: { providers: pushProviders },
			slack: { providers: slackProviders },
			telegram: { providers: telegramProviders },
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
		},
	};
}
