import { describe, expect, it } from "vitest";
import { ERROR_STATUS_CODES, type EmitoErrorCode } from "../errors";
import {
	BrandThemeSchema,
	ChannelDeliveryParamsSchema,
	ChannelResultSchema,
	ChannelSchema,
	DeliveryResultSchema,
	DeliveryStatusSchema,
	DiscordContentSchema,
	EmailContentSchema,
	EmitoConfigSchema,
	EmitoTransportConfigSchema,
	EventDefinitionSchema,
	InAppActionSchema,
	InAppContentSchema,
	ObservabilityConfigSchema,
	PreferenceRecordSchema,
	PushContentSchema,
	RateLimitConfigSchema,
	RetryPolicySchema,
	SendParamsSchema,
	SendResultSchema,
	SlackContentSchema,
	SmsContentSchema,
	SubscriberSchema,
	TelegramContentSchema,
	WorkspaceDefaultSchema,
} from "../schemas/index";

describe("ChannelSchema", () => {
	it("accepts all 10 channels", () => {
		const channels = [
			"email",
			"sms",
			"push",
			"inApp",
			"webhook",
			"slack",
			"telegram",
			"discord",
			"whatsapp",
			"webPush",
		];
		for (const ch of channels) {
			expect(ChannelSchema.parse(ch)).toBe(ch);
		}
	});

	it("rejects invalid channel", () => {
		expect(() => ChannelSchema.parse("fax")).toThrow();
	});
});

describe("DeliveryStatusSchema", () => {
	it("accepts all 17 statuses", () => {
		const statuses = [
			"pending",
			"sent",
			"delivered",
			"deferred",
			"bounced",
			"failed",
			"suppressed",
			"complained",
			"opened",
			"machine_opened",
			"clicked",
			"unsubscribed",
			"read",
			"digested",
			"blocked_by_preference",
			"blocked_by_consent",
			"blocked_by_admin",
		];
		for (const s of statuses) {
			expect(DeliveryStatusSchema.parse(s)).toBe(s);
		}
	});

	it("rejects invalid status", () => {
		expect(() => DeliveryStatusSchema.parse("unknown")).toThrow();
	});
});

describe("RetryPolicySchema", () => {
	it("validates a complete retry policy", () => {
		const policy = {
			maxAttempts: 5,
			initialDelay: 1000,
			maxDelay: 60_000,
			backoff: "exponential" as const,
			jitter: true,
		};
		expect(RetryPolicySchema.parse(policy)).toEqual(policy);
	});

	it("rejects negative maxAttempts", () => {
		expect(() =>
			RetryPolicySchema.parse({
				maxAttempts: -1,
				initialDelay: 1000,
				maxDelay: 60_000,
				backoff: "exponential",
			}),
		).toThrow();
	});
});

describe("RateLimitConfigSchema", () => {
	it("validates rate limit config", () => {
		const config = { max: 20, windowMs: 3_600_000 };
		expect(RateLimitConfigSchema.parse(config)).toEqual(config);
	});
});

describe("BrandThemeSchema", () => {
	it("validates minimal brand theme", () => {
		const theme = { name: "My App", appUrl: "https://myapp.com" };
		expect(BrandThemeSchema.parse(theme)).toEqual(theme);
	});

	it("validates full brand theme", () => {
		const theme = {
			name: "My App",
			logoUrl: "https://myapp.com/logo.png",
			appUrl: "https://myapp.com",
			primaryColor: "#6366f1",
			secondaryColor: "#818cf8",
			backgroundColor: "#f9fafb",
			textColor: "#111827",
			fontFamily: "Inter, system-ui, sans-serif",
			supportEmail: "support@myapp.com",
			privacyUrl: "https://myapp.com/privacy",
			unsubscribeUrl: "https://myapp.com/unsubscribe",
			footer: "Sent by My App",
		};
		expect(BrandThemeSchema.parse(theme)).toEqual(theme);
	});
});

describe("ObservabilityConfigSchema", () => {
	it("validates observability config", () => {
		const config = {
			metrics: { enabled: true, prefix: "emito" },
			tracing: { enabled: true },
		};
		expect(ObservabilityConfigSchema.parse(config)).toEqual(config);
	});
});

describe("EmitoConfigSchema", () => {
	it("validates minimal config", () => {
		const config = {
			database: { url: "postgresql://localhost/test" },
			redis: { url: "redis://localhost" },
		};
		expect(EmitoConfigSchema.parse(config)).toEqual(config);
	});

	it("rejects config without database url", () => {
		expect(() =>
			EmitoConfigSchema.parse({
				database: { url: "" },
				redis: { url: "redis://localhost" },
			}),
		).toThrow();
	});
});

describe("EventDefinitionSchema", () => {
	it("validates event definition with digest", () => {
		const event = {
			category: "transactional",
			channels: ["email", "inApp"],
			priority: "high" as const,
			digest: { windowMs: 300_000, maxCount: 50, channels: ["email"] },
		};
		expect(EventDefinitionSchema.parse(event)).toEqual(event);
	});
});

describe("SendParamsSchema", () => {
	it("validates minimal send params", () => {
		const params = {
			event: "order.filled",
			subscriberId: "user_123",
			payload: { orderId: "ord_789" },
		};
		expect(SendParamsSchema.parse(params)).toEqual(params);
	});

	it("validates full send params", () => {
		const params = {
			event: "order.filled",
			subscriberId: "user_123",
			workspaceId: "ws_456",
			recipient: { email: "user@example.com", phone: "+1555", pushTokens: ["token1"] },
			payload: { orderId: "ord_789" },
			locale: "en",
			scheduledAt: new Date("2026-04-01"),
			delay: "5m",
			idempotencyKey: "idem_123",
			providerOverrides: { sendgrid: { categories: ["order"] } },
		};
		expect(SendParamsSchema.parse(params)).toEqual(params);
	});

	it("rejects empty event", () => {
		expect(() =>
			SendParamsSchema.parse({
				event: "",
				subscriberId: "user_123",
				payload: {},
			}),
		).toThrow();
	});
});

describe("ChannelResultSchema", () => {
	it("validates channel result", () => {
		const result = {
			channel: "email",
			status: "sent" as const,
			provider: "resend",
			providerMessageId: "msg_123",
		};
		expect(ChannelResultSchema.parse(result)).toEqual(result);
	});

	it("validates failed channel result with error", () => {
		const result = {
			channel: "sms",
			status: "failed" as const,
			provider: "twilio",
			error: "Invalid number",
			errorClassification: "permanent" as const,
		};
		expect(ChannelResultSchema.parse(result)).toEqual(result);
	});
});

describe("SendResultSchema", () => {
	it("validates send result", () => {
		const result = {
			notificationId: "notif_123",
			channels: [{ channel: "email", status: "sent" as const }],
		};
		expect(SendResultSchema.parse(result)).toEqual(result);
	});
});

describe("PreferenceRecordSchema", () => {
	it("validates preference record", () => {
		const record = {
			subscriberId: "user_123",
			topicKey: "newsletter",
			channel: "email" as const,
			enabled: true,
		};
		expect(PreferenceRecordSchema.parse(record)).toEqual(record);
	});

	it("validates workspace-scoped preference", () => {
		const record = {
			subscriberId: "user_123",
			workspaceId: "ws_456",
			topicKey: "newsletter",
			channel: "email" as const,
			enabled: false,
		};
		expect(PreferenceRecordSchema.parse(record)).toEqual(record);
	});
});

describe("WorkspaceDefaultSchema", () => {
	it("validates workspace default", () => {
		const def = {
			workspaceId: "ws_456",
			topicKey: "promotions",
			channel: "sms" as const,
			enabled: false,
			isMandatory: true,
		};
		expect(WorkspaceDefaultSchema.parse(def)).toEqual(def);
	});
});

describe("ChannelDeliveryParamsSchema (discriminated union)", () => {
	it("validates email delivery params", () => {
		const params = {
			channel: "email" as const,
			to: "user@example.com",
			subject: "Hello",
			html: "<p>Hi</p>",
			text: "Hi",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "welcome",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates sms delivery params", () => {
		const params = {
			channel: "sms" as const,
			to: "+1555",
			body: "Your code is 123456",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "2fa",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates push delivery params", () => {
		const params = {
			channel: "push" as const,
			tokens: ["token1"],
			title: "Alert",
			body: "New message",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates slack delivery params", () => {
		const params = {
			channel: "slack" as const,
			webhookUrl: "https://hooks.slack.com/services/T/B/xxx",
			blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
			text: "Hello",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates telegram delivery params", () => {
		const params = {
			channel: "telegram" as const,
			botToken: "123456:ABC",
			chatId: "-1001234567890",
			html: "<b>Alert</b>",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates discord delivery params", () => {
		const params = {
			channel: "discord" as const,
			webhookUrl: "https://discord.com/api/webhooks/123/abc",
			content: "Hello",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates inApp delivery params", () => {
		const params = {
			channel: "inApp" as const,
			subscriberId: "s_1",
			title: "New notification",
			body: "You have a new message",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates webhook delivery params", () => {
		const params = {
			channel: "webhook" as const,
			url: "https://example.com/webhook",
			payload: { event: "order.filled" },
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates whatsapp delivery params", () => {
		const params = {
			channel: "whatsapp" as const,
			to: "+1555123456",
			templateName: "order_confirmation",
			templateParams: { orderId: "ord_123" },
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "order",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("validates webPush delivery params", () => {
		const params = {
			channel: "webPush" as const,
			subscription: {
				endpoint: "https://fcm.googleapis.com/fcm/send/abc",
				keys: { p256dh: "BNcRd...", auth: "tBH..." },
			},
			title: "Alert",
			body: "New message",
			metadata: {
				notificationId: "n_1",
				subscriberId: "s_1",
				eventType: "alert",
			},
		};
		expect(ChannelDeliveryParamsSchema.parse(params)).toEqual(params);
	});

	it("rejects unknown channel", () => {
		expect(() =>
			ChannelDeliveryParamsSchema.parse({
				channel: "fax",
				metadata: {
					notificationId: "n_1",
					subscriberId: "s_1",
					eventType: "alert",
				},
			}),
		).toThrow();
	});
});

describe("DeliveryResultSchema", () => {
	it("validates success result", () => {
		const result = { success: true, providerMessageId: "msg_123" };
		expect(DeliveryResultSchema.parse(result)).toEqual(result);
	});

	it("validates failure result", () => {
		const result = {
			success: false,
			error: "Timeout",
			errorClassification: "transient" as const,
		};
		expect(DeliveryResultSchema.parse(result)).toEqual(result);
	});
});

describe("SubscriberSchema", () => {
	it("validates minimal subscriber", () => {
		const now = new Date();
		const sub = { id: "user_123", createdAt: now, updatedAt: now };
		expect(SubscriberSchema.parse(sub)).toEqual(sub);
	});
});

describe("EmitoTransportConfigSchema", () => {
	it("validates transport config", () => {
		expect(EmitoTransportConfigSchema.parse({ type: "websocket" })).toEqual({
			type: "websocket",
		});
	});

	it("rejects invalid transport type", () => {
		expect(() => EmitoTransportConfigSchema.parse({ type: "grpc" })).toThrow();
	});
});

describe("EmailContentSchema", () => {
	it("validates email content", () => {
		const content = { subject: "Hello", html: "<p>Hi</p>", text: "Hi" };
		expect(EmailContentSchema.parse(content)).toEqual(content);
	});

	it("rejects empty subject", () => {
		expect(() =>
			EmailContentSchema.parse({ subject: "", html: "<p>Hi</p>", text: "Hi" }),
		).toThrow();
	});
});

describe("SmsContentSchema", () => {
	it("validates sms content", () => {
		const content = { body: "Your code is 123456" };
		expect(SmsContentSchema.parse(content)).toEqual(content);
	});

	it("rejects empty body", () => {
		expect(() => SmsContentSchema.parse({ body: "" })).toThrow();
	});
});

describe("PushContentSchema", () => {
	it("validates push content", () => {
		const content = { title: "Alert", body: "New message" };
		expect(PushContentSchema.parse(content)).toEqual(content);
	});

	it("validates push content with data", () => {
		const content = { title: "Alert", body: "New message", data: { orderId: "ord_1" } };
		expect(PushContentSchema.parse(content)).toEqual(content);
	});
});

describe("InAppContentSchema", () => {
	it("validates minimal inApp content", () => {
		const content = { body: "You have a new message" };
		expect(InAppContentSchema.parse(content)).toEqual(content);
	});

	it("validates full inApp content", () => {
		const content = {
			subject: "Order Filled",
			body: "Order #123 filled",
			actionUrl: "/orders/123",
			primaryAction: { label: "View Order", url: "/orders/123" },
			secondaryAction: { label: "Dismiss", url: "/dismiss" },
			avatar: "https://example.com/avatar.png",
			data: { orderId: "123" },
		};
		expect(InAppContentSchema.parse(content)).toEqual(content);
	});

	it("rejects empty body", () => {
		expect(() => InAppContentSchema.parse({ body: "" })).toThrow();
	});
});

describe("InAppActionSchema", () => {
	it("validates action", () => {
		const action = { label: "View", url: "/view" };
		expect(InAppActionSchema.parse(action)).toEqual(action);
	});

	it("rejects empty label", () => {
		expect(() => InAppActionSchema.parse({ label: "", url: "/view" })).toThrow();
	});
});

describe("SlackContentSchema", () => {
	it("validates slack content", () => {
		const content = {
			blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
			text: "Hello",
		};
		expect(SlackContentSchema.parse(content)).toEqual(content);
	});
});

describe("TelegramContentSchema", () => {
	it("validates telegram content", () => {
		const content = { html: "<b>Alert</b>" };
		expect(TelegramContentSchema.parse(content)).toEqual(content);
	});

	it("rejects empty html", () => {
		expect(() => TelegramContentSchema.parse({ html: "" })).toThrow();
	});
});

describe("DiscordContentSchema", () => {
	it("validates discord content", () => {
		const content = { content: "Hello world" };
		expect(DiscordContentSchema.parse(content)).toEqual(content);
	});

	it("validates discord content with embeds", () => {
		const content = {
			content: "Hello",
			embeds: [{ title: "Order", description: "Order filled" }],
		};
		expect(DiscordContentSchema.parse(content)).toEqual(content);
	});

	it("rejects empty content", () => {
		expect(() => DiscordContentSchema.parse({ content: "" })).toThrow();
	});
});

describe("Error code completeness", () => {
	it("ERROR_STATUS_CODES keys match exactly 48 error codes", () => {
		const codes = Object.keys(ERROR_STATUS_CODES) as EmitoErrorCode[];
		expect(codes).toHaveLength(48);
	});
});
