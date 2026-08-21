/**
 * Contract tests for all 9 repository interfaces and their in-memory implementations.
 *
 * These tests run against the in-memory implementations only.
 * Integration tests against DB-backed implementations live in __tests__/integration/.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
	InMemoryDeadLetterRepository,
	InMemoryInboxRepository,
	InMemoryIntegrationRepository,
	InMemoryNotificationRepository,
	InMemoryPreferenceRepository,
	InMemoryPushTokenRepository,
	InMemorySubscriberRepository,
	InMemorySubscriptionRepository,
	InMemorySuppressionRepository,
	InMemoryWorkspaceDefaultRepository,
} from "../src/repositories/in-memory/index";

// ---------------------------------------------------------------------------
// Test data builders (always use builders, never inline literals)
// ---------------------------------------------------------------------------

let _counter = 0;
function nextId() {
	return `test_${++_counter}`;
}

function createSubscriberRecord(
	overrides: Partial<{
		id: string;
		email: string | null;
		phone: string | null;
		locale: string;
		timezone: string | null;
		globallyUnsubscribed: boolean;
		metadata: Record<string, unknown>;
		erasedAt: Date | null;
		createdAt: Date;
		updatedAt: Date;
	}> = {},
) {
	const id = nextId();
	return {
		id,
		email: `user${id}@example.com`,
		phone: null,
		locale: "en",
		timezone: null,
		globallyUnsubscribed: false,
		metadata: {},
		erasedAt: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function createNotificationRecord(
	overrides: Partial<{
		id: string;
		subscriberId: string;
		workspaceId: string | null;
		eventType: string;
		category: string;
		channel: string;
		status: string;
		provider: string | null;
		providerMsgId: string | null;
		errorMessage: string | null;
		errorClassification: string | null;
		attempts: number;
		payload: Record<string, unknown>;
		metadata: Record<string, unknown>;
		idempotencyKey: string | null;
		createdAt: Date;
		sentAt: Date | null;
		deliveredAt: Date | null;
		failedAt: Date | null;
	}> = {},
) {
	const id = nextId();
	return {
		id,
		subscriberId: `sub_${nextId()}`,
		workspaceId: null,
		eventType: "user.welcome",
		category: "transactional",
		channel: "email",
		status: "pending",
		provider: null,
		providerMsgId: null,
		errorMessage: null,
		errorClassification: null,
		attempts: 0,
		payload: {},
		metadata: {},
		idempotencyKey: null,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		sentAt: null,
		deliveredAt: null,
		failedAt: null,
		...overrides,
	};
}

function createPreferenceRecord(
	overrides: Partial<{
		id: string;
		subscriberId: string;
		workspaceId: string | null;
		topicKey: string;
		channel: string | null;
		enabled: boolean;
	}> = {},
) {
	return {
		id: nextId(),
		subscriberId: `sub_${nextId()}`,
		workspaceId: null,
		topicKey: "general",
		channel: null,
		enabled: true,
		...overrides,
	};
}

function createWorkspaceDefaultRecord(
	overrides: Partial<{
		id: string;
		workspaceId: string;
		topicKey: string;
		channel: string | null;
		enabled: boolean;
		isMandatory: boolean;
	}> = {},
) {
	return {
		id: nextId(),
		workspaceId: `ws_${nextId()}`,
		topicKey: "general",
		channel: null,
		enabled: true,
		isMandatory: false,
		...overrides,
	};
}

function createSuppressionRecord(
	overrides: Partial<{
		address: string;
		channel: string;
		reason: string;
		provider: string | null;
	}> = {},
) {
	const id = nextId();
	return {
		address: `user${id}@example.com`,
		channel: "email",
		reason: "bounce",
		provider: null,
		...overrides,
	};
}

function createSubscriptionRecord(
	overrides: Partial<{
		id: string;
		subscriberId: string;
		topicId: string;
		channel: string;
		status: string;
	}> = {},
) {
	return {
		id: nextId(),
		subscriberId: `sub_${nextId()}`,
		topicId: `topic_${nextId()}`,
		channel: "email",
		status: "opted_in",
		...overrides,
	};
}

function createDeadLetterRecord(
	overrides: Partial<{
		notificationId: string;
		subscriberId: string;
		eventType: string;
		channel: string;
		attempts: Array<{ provider: string; timestamp: Date; errorCode: string; errorMessage: string }>;
		payload: Record<string, unknown>;
	}> = {},
) {
	return {
		notificationId: `notif_${nextId()}`,
		subscriberId: `sub_${nextId()}`,
		eventType: "user.welcome",
		channel: "email",
		attempts: [
			{
				provider: "sendgrid",
				timestamp: new Date("2026-01-01T00:00:00Z"),
				errorCode: "PROVIDER_UNAVAILABLE",
				errorMessage: "Connection refused",
			},
		],
		payload: { subject: "Welcome" },
		...overrides,
	};
}

function createIntegrationRecord(
	overrides: Partial<{
		id: string;
		ownerId: string;
		subscriberId: string | null;
		name: string | null;
		channel: string;
		events: string[] | null;
		config: Record<string, unknown>;
		active: boolean;
	}> = {},
) {
	return {
		id: nextId(),
		ownerId: `owner_${nextId()}`,
		subscriberId: null,
		name: null,
		channel: "slack",
		events: null,
		config: { webhookUrl: "https://hooks.slack.com/test" },
		active: true,
		...overrides,
	};
}

function createInboxRecord(
	overrides: Partial<{
		subscriberId: string;
		workspaceId: string | null;
		eventType: string;
		category: string;
		topicKey: string | null;
		subject: string | null;
		body: string;
		data: Record<string, unknown>;
	}> = {},
) {
	return {
		subscriberId: `sub_${nextId()}`,
		workspaceId: null,
		eventType: "user.welcome",
		category: "transactional",
		topicKey: null,
		subject: "Welcome",
		body: "Hello, world!",
		data: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// SubscriberRepository contract tests
// ---------------------------------------------------------------------------

describe("SubscriberRepository", () => {
	let repo: InMemorySubscriberRepository;

	beforeEach(() => {
		repo = new InMemorySubscriberRepository();
	});

	describe("findById", () => {
		it("should return subscriber when found", async () => {
			const subscriber = createSubscriberRecord({ id: "sub_1" });
			await repo.seed(subscriber);

			const result = await repo.findById("sub_1");

			expect(result).toMatchObject({
				id: "sub_1",
				email: subscriber.email,
				globallyUnsubscribed: false,
				erasedAt: null,
			});
		});

		it("should return null when subscriber does not exist", async () => {
			const result = await repo.findById("nonexistent");
			expect(result).toBeNull();
		});

		it("should return subscriber with erasedAt set when erased", async () => {
			const erasedAt = new Date("2026-01-15T00:00:00Z");
			const subscriber = createSubscriberRecord({ id: "sub_erased", erasedAt });
			await repo.seed(subscriber);

			const result = await repo.findById("sub_erased");
			expect(result).toMatchObject({ id: "sub_erased", erasedAt });
		});

		it("should return null for empty string id", async () => {
			const result = await repo.findById("");
			expect(result).toBeNull();
		});
	});

	describe("update", () => {
		it("should update subscriber fields", async () => {
			const subscriber = createSubscriberRecord({ id: "sub_upd" });
			await repo.seed(subscriber);

			await repo.update("sub_upd", { globallyUnsubscribed: true });

			const result = await repo.findById("sub_upd");
			expect(result).toMatchObject({ id: "sub_upd", globallyUnsubscribed: true });
		});

		it("should not affect other subscribers", async () => {
			const s1 = createSubscriberRecord({ id: "sub_a" });
			const s2 = createSubscriberRecord({ id: "sub_b" });
			await repo.seed(s1);
			await repo.seed(s2);

			await repo.update("sub_a", { globallyUnsubscribed: true });

			const result = await repo.findById("sub_b");
			expect(result).toMatchObject({ globallyUnsubscribed: false });
		});
	});

	describe("clear", () => {
		it("should remove all seeded subscribers", async () => {
			const subscriber = createSubscriberRecord({ id: "sub_clear" });
			repo.seed(subscriber);
			repo.clear();
			const result = await repo.findById("sub_clear");
			expect(result).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// NotificationRepository contract tests
// ---------------------------------------------------------------------------

describe("NotificationRepository", () => {
	let repo: InMemoryNotificationRepository;

	beforeEach(() => {
		repo = new InMemoryNotificationRepository();
	});

	describe("create", () => {
		it("should create and return a notification record", async () => {
			const record = createNotificationRecord({ subscriberId: "sub_1", channel: "email" });

			const result = await repo.create(record);

			expect(result).toMatchObject({
				subscriberId: "sub_1",
				channel: "email",
				status: "pending",
			});
			expect(result.id).toBeDefined();
		});

		it("should assign an id if not provided", async () => {
			const record = createNotificationRecord();
			const withoutId = { ...record };

			const result = await repo.create(withoutId);
			expect(typeof result.id).toBe("string");
			expect(result.id.length).toBeGreaterThan(0);
		});
	});

	describe("findById", () => {
		it("should return notification when found", async () => {
			const record = createNotificationRecord({ id: "notif_1" });
			await repo.create(record);

			const result = await repo.findById("notif_1");
			expect(result).toMatchObject({ id: "notif_1" });
		});

		it("should return null for unknown id", async () => {
			const result = await repo.findById("notif_unknown");
			expect(result).toBeNull();
		});
	});

	describe("updateStatus", () => {
		it("should update notification status", async () => {
			const record = createNotificationRecord({ id: "notif_status" });
			await repo.create(record);

			await repo.updateStatus("notif_status", "sent", {
				provider: "sendgrid",
				sentAt: new Date("2026-01-01T01:00:00Z"),
			});

			const result = await repo.findById("notif_status");
			expect(result).toMatchObject({ id: "notif_status", status: "sent", provider: "sendgrid" });
		});

		it("should record failedAt when status is failed", async () => {
			const record = createNotificationRecord({ id: "notif_fail" });
			await repo.create(record);
			const failedAt = new Date("2026-01-01T02:00:00Z");

			await repo.updateStatus("notif_fail", "failed", { failedAt });

			const result = await repo.findById("notif_fail");
			expect(result).toMatchObject({ status: "failed" });
		});
	});

	describe("clear", () => {
		it("should remove all notifications", async () => {
			await repo.create(createNotificationRecord({ id: "notif_clear" }));
			repo.clear();
			const result = await repo.findById("notif_clear");
			expect(result).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// PreferenceRepository contract tests
// ---------------------------------------------------------------------------

describe("PreferenceRepository", () => {
	let repo: InMemoryPreferenceRepository;

	beforeEach(() => {
		repo = new InMemoryPreferenceRepository();
	});

	describe("findBySubscriber", () => {
		it("should return all preferences for subscriber", async () => {
			const subscriberId = "sub_pref";
			const pref1 = createPreferenceRecord({ subscriberId, topicKey: "alerts", channel: "email" });
			const pref2 = createPreferenceRecord({ subscriberId, topicKey: "alerts", channel: "sms" });
			await repo.seed(pref1);
			await repo.seed(pref2);

			const results = await repo.findBySubscriber(subscriberId, {});
			expect(results).toHaveLength(2);
			expect(results.every((p) => p.subscriberId === subscriberId)).toBe(true);
		});

		it("should filter by workspaceId when provided", async () => {
			const subscriberId = "sub_pref_ws";
			const ws1Pref = createPreferenceRecord({
				subscriberId,
				workspaceId: "ws_1",
				topicKey: "alerts",
			});
			const globalPref = createPreferenceRecord({
				subscriberId,
				workspaceId: null,
				topicKey: "alerts",
			});
			await repo.seed(ws1Pref);
			await repo.seed(globalPref);

			const results = await repo.findBySubscriber(subscriberId, { workspaceId: "ws_1" });
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ workspaceId: "ws_1" });
		});

		it("should filter by topicKey when provided", async () => {
			const subscriberId = "sub_pref_topic";
			const alertPref = createPreferenceRecord({ subscriberId, topicKey: "alerts" });
			const marketingPref = createPreferenceRecord({ subscriberId, topicKey: "marketing" });
			await repo.seed(alertPref);
			await repo.seed(marketingPref);

			const results = await repo.findBySubscriber(subscriberId, { topicKey: "alerts" });
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ topicKey: "alerts" });
		});

		it("should filter by channel when provided", async () => {
			const subscriberId = "sub_pref_ch";
			const emailPref = createPreferenceRecord({ subscriberId, channel: "email" });
			const smsPref = createPreferenceRecord({ subscriberId, channel: "sms" });
			await repo.seed(emailPref);
			await repo.seed(smsPref);

			const results = await repo.findBySubscriber(subscriberId, { channel: "email" });
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ channel: "email" });
		});

		it("should return empty array when subscriber has no preferences", async () => {
			const results = await repo.findBySubscriber("sub_no_prefs", {});
			expect(results).toEqual([]);
		});
	});

	describe("clear", () => {
		it("should remove all preferences", async () => {
			repo.seed(createPreferenceRecord({ subscriberId: "sub_clear_pref" }));
			repo.clear();
			const results = await repo.findBySubscriber("sub_clear_pref");
			expect(results).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// WorkspaceDefaultRepository contract tests
// ---------------------------------------------------------------------------

describe("WorkspaceDefaultRepository", () => {
	let repo: InMemoryWorkspaceDefaultRepository;

	beforeEach(() => {
		repo = new InMemoryWorkspaceDefaultRepository();
	});

	describe("findByWorkspace", () => {
		it("should return all defaults for a workspace", async () => {
			const workspaceId = "ws_defaults";
			const def1 = createWorkspaceDefaultRecord({ workspaceId, topicKey: "alerts" });
			const def2 = createWorkspaceDefaultRecord({ workspaceId, topicKey: "marketing" });
			await repo.seed(def1);
			await repo.seed(def2);

			const results = await repo.findByWorkspace(workspaceId);
			expect(results).toHaveLength(2);
			expect(results.every((d) => d.workspaceId === workspaceId)).toBe(true);
		});

		it("should not return defaults from another workspace", async () => {
			const def1 = createWorkspaceDefaultRecord({ workspaceId: "ws_a" });
			const def2 = createWorkspaceDefaultRecord({ workspaceId: "ws_b" });
			await repo.seed(def1);
			await repo.seed(def2);

			const results = await repo.findByWorkspace("ws_a");
			expect(results.every((d) => d.workspaceId === "ws_a")).toBe(true);
		});

		it("should return empty array for unknown workspace", async () => {
			const results = await repo.findByWorkspace("ws_unknown");
			expect(results).toEqual([]);
		});

		it("should correctly return isMandatory flag", async () => {
			const def = createWorkspaceDefaultRecord({
				workspaceId: "ws_mandatory",
				isMandatory: true,
				enabled: false,
			});
			await repo.seed(def);

			const results = await repo.findByWorkspace("ws_mandatory");
			expect(results[0]).toMatchObject({ isMandatory: true, enabled: false });
		});
	});

	describe("clear", () => {
		it("should remove all defaults", async () => {
			repo.seed(createWorkspaceDefaultRecord({ workspaceId: "ws_clear" }));
			repo.clear();
			const results = await repo.findByWorkspace("ws_clear");
			expect(results).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// SuppressionRepository contract tests
// ---------------------------------------------------------------------------

describe("SuppressionRepository", () => {
	let repo: InMemorySuppressionRepository;

	beforeEach(() => {
		repo = new InMemorySuppressionRepository();
	});

	describe("findByAddressAndChannel", () => {
		it("should return suppression record when address is suppressed on channel", async () => {
			const record = createSuppressionRecord({ address: "bounce@example.com", channel: "email" });
			await repo.create(record);

			const result = await repo.findByAddressAndChannel("bounce@example.com", "email");
			expect(result).toMatchObject({
				address: "bounce@example.com",
				channel: "email",
				reason: "bounce",
			});
		});

		it("should return null when address is not suppressed", async () => {
			const result = await repo.findByAddressAndChannel("clean@example.com", "email");
			expect(result).toBeNull();
		});

		it("should return null when address is suppressed on different channel", async () => {
			const record = createSuppressionRecord({ address: "user@example.com", channel: "sms" });
			await repo.create(record);

			const result = await repo.findByAddressAndChannel("user@example.com", "email");
			expect(result).toBeNull();
		});

		it("should handle empty address string", async () => {
			const result = await repo.findByAddressAndChannel("", "email");
			expect(result).toBeNull();
		});
	});

	describe("create", () => {
		it("should create suppression record and make it findable", async () => {
			const record = createSuppressionRecord({
				address: "new-suppress@example.com",
				channel: "email",
			});

			await repo.create(record);

			const result = await repo.findByAddressAndChannel("new-suppress@example.com", "email");
			expect(result).not.toBeNull();
			expect(result).toMatchObject({ address: "new-suppress@example.com", channel: "email" });
		});

		it("should store provider when provided", async () => {
			const record = createSuppressionRecord({
				address: "with-provider@example.com",
				channel: "email",
				provider: "sendgrid",
			});

			await repo.create(record);

			const result = await repo.findByAddressAndChannel("with-provider@example.com", "email");
			expect(result).toMatchObject({ provider: "sendgrid" });
		});
	});

	describe("clear", () => {
		it("should remove all suppression records", async () => {
			await repo.create(
				createSuppressionRecord({ address: "clear@example.com", channel: "email" }),
			);
			repo.clear();
			const result = await repo.findByAddressAndChannel("clear@example.com", "email");
			expect(result).toBeNull();
		});
	});
});

// ---------------------------------------------------------------------------
// SubscriptionRepository contract tests
// ---------------------------------------------------------------------------

describe("SubscriptionRepository", () => {
	let repo: InMemorySubscriptionRepository;

	beforeEach(() => {
		repo = new InMemorySubscriptionRepository();
	});

	describe("findBySubscriberAndTopic", () => {
		it("should return subscriptions for subscriber and topic", async () => {
			const subscriberId = "sub_subscription";
			const topicId = "topic_1";
			const sub = createSubscriptionRecord({
				subscriberId,
				topicId,
				channel: "email",
				status: "opted_in",
			});
			await repo.seed(sub);

			const results = await repo.findBySubscriberAndTopic(subscriberId, topicId);
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				subscriberId,
				topicId,
				channel: "email",
				status: "opted_in",
			});
		});

		it("should return multiple channel subscriptions for same subscriber+topic", async () => {
			const subscriberId = "sub_multi_ch";
			const topicId = "topic_multi";
			await repo.seed(createSubscriptionRecord({ subscriberId, topicId, channel: "email" }));
			await repo.seed(createSubscriptionRecord({ subscriberId, topicId, channel: "sms" }));

			const results = await repo.findBySubscriberAndTopic(subscriberId, topicId);
			expect(results).toHaveLength(2);
		});

		it("should return empty array when no subscriptions exist", async () => {
			const results = await repo.findBySubscriberAndTopic("sub_none", "topic_none");
			expect(results).toEqual([]);
		});

		it("should not return subscriptions for different topic", async () => {
			const subscriberId = "sub_cross_topic";
			await repo.seed(createSubscriptionRecord({ subscriberId, topicId: "topic_a" }));

			const results = await repo.findBySubscriberAndTopic(subscriberId, "topic_b");
			expect(results).toEqual([]);
		});

		it("should return opted_out subscriptions too (caller decides policy)", async () => {
			const subscriberId = "sub_opted_out";
			const topicId = "topic_opted_out";
			await repo.seed(createSubscriptionRecord({ subscriberId, topicId, status: "opted_out" }));

			const results = await repo.findBySubscriberAndTopic(subscriberId, topicId);
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ status: "opted_out" });
		});
	});

	describe("clear", () => {
		it("should remove all subscriptions", async () => {
			repo.seed(
				createSubscriptionRecord({ subscriberId: "sub_clear_sub", topicId: "topic_clear" }),
			);
			repo.clear();
			const results = await repo.findBySubscriberAndTopic("sub_clear_sub", "topic_clear");
			expect(results).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// DeadLetterRepository contract tests
// ---------------------------------------------------------------------------

describe("DeadLetterRepository", () => {
	let repo: InMemoryDeadLetterRepository;

	beforeEach(() => {
		repo = new InMemoryDeadLetterRepository();
	});

	describe("create", () => {
		it("should create dead letter entry with full attempt history", async () => {
			const record = createDeadLetterRecord({
				notificationId: "notif_dlq",
				subscriberId: "sub_dlq",
				eventType: "user.welcome",
				channel: "email",
				attempts: [
					{
						provider: "sendgrid",
						timestamp: new Date("2026-01-01T00:00:00Z"),
						errorCode: "PROVIDER_TIMEOUT",
						errorMessage: "Timed out",
					},
					{
						provider: "mailgun",
						timestamp: new Date("2026-01-01T00:01:00Z"),
						errorCode: "PROVIDER_UNAVAILABLE",
						errorMessage: "503",
					},
				],
				payload: { subject: "Welcome!" },
			});

			const result = await repo.create(record);

			expect(result).toMatchObject({
				notificationId: "notif_dlq",
				subscriberId: "sub_dlq",
				eventType: "user.welcome",
				channel: "email",
			});
			expect(result.attempts).toHaveLength(2);
			expect(result.id).toBeDefined();
		});

		it("should create entry with single attempt", async () => {
			const record = createDeadLetterRecord();
			const result = await repo.create(record);

			expect(result.attempts).toHaveLength(1);
		});

		it("should create entry with empty payload", async () => {
			const record = createDeadLetterRecord({ payload: {} });
			const result = await repo.create(record);
			expect(result.payload).toEqual({});
		});
	});

	describe("getAll", () => {
		it("should return all dead letter records", async () => {
			await repo.create(createDeadLetterRecord());
			await repo.create(createDeadLetterRecord());
			const all = repo.getAll();
			expect(all).toHaveLength(2);
		});
	});

	describe("clear", () => {
		it("should remove all dead letter records", async () => {
			await repo.create(createDeadLetterRecord());
			repo.clear();
			const all = repo.getAll();
			expect(all).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// IntegrationRepository contract tests
// ---------------------------------------------------------------------------

describe("IntegrationRepository", () => {
	let repo: InMemoryIntegrationRepository;

	beforeEach(() => {
		repo = new InMemoryIntegrationRepository();
	});

	describe("findBySubscriberAndChannel", () => {
		it("should return active integrations for subscriber and channel", async () => {
			const subscriberId = "sub_integ";
			const integration = createIntegrationRecord({ subscriberId, channel: "slack", active: true });
			await repo.seed(integration);

			const results = await repo.findBySubscriberAndChannel(subscriberId, "slack");
			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({ subscriberId, channel: "slack", active: true });
		});

		it("should return multiple active integrations for same subscriber+channel", async () => {
			const subscriberId = "sub_multi_integ";
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "slack", active: true }));
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "slack", active: true }));

			const results = await repo.findBySubscriberAndChannel(subscriberId, "slack");
			expect(results).toHaveLength(2);
		});

		it("should not return inactive integrations", async () => {
			const subscriberId = "sub_inactive_integ";
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "slack", active: false }));

			const results = await repo.findBySubscriberAndChannel(subscriberId, "slack");
			expect(results).toEqual([]);
		});

		it("should not return integrations for different channel", async () => {
			const subscriberId = "sub_diff_ch_integ";
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "telegram" }));

			const results = await repo.findBySubscriberAndChannel(subscriberId, "slack");
			expect(results).toEqual([]);
		});

		it("should return empty array when subscriber has no integrations", async () => {
			const results = await repo.findBySubscriberAndChannel("sub_no_integ", "slack");
			expect(results).toEqual([]);
		});

		it("should include config in returned integrations", async () => {
			const subscriberId = "sub_config_integ";
			const config = { webhookUrl: "https://hooks.slack.com/services/T000/B000/xxxx" };
			await repo.seed(createIntegrationRecord({ subscriberId, channel: "slack", config }));

			const results = await repo.findBySubscriberAndChannel(subscriberId, "slack");
			expect(results[0]).toMatchObject({ config });
		});
	});

	describe("clear", () => {
		it("should remove all integrations", async () => {
			repo.seed(createIntegrationRecord({ subscriberId: "sub_clear_integ", channel: "slack" }));
			repo.clear();
			const results = await repo.findBySubscriberAndChannel("sub_clear_integ", "slack");
			expect(results).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// InboxRepository contract tests
// ---------------------------------------------------------------------------

describe("InboxRepository", () => {
	let repo: InMemoryInboxRepository;

	beforeEach(() => {
		repo = new InMemoryInboxRepository();
	});

	describe("create", () => {
		it("should create inbox entry and return it with an id", async () => {
			const record = createInboxRecord({
				subscriberId: "sub_inbox",
				eventType: "user.welcome",
				category: "transactional",
				subject: "Welcome!",
				body: "Hello there",
			});

			const result = await repo.create(record);

			expect(result).toMatchObject({
				subscriberId: "sub_inbox",
				eventType: "user.welcome",
				category: "transactional",
				subject: "Welcome!",
				body: "Hello there",
			});
			expect(result.id).toBeDefined();
			expect(typeof result.id).toBe("string");
		});

		it("should create inbox entry without subject (nullable)", async () => {
			const record = createInboxRecord({ subject: null });
			const result = await repo.create(record);
			expect(result.subject).toBeNull();
		});

		it("should create inbox entry with workspaceId", async () => {
			const record = createInboxRecord({ workspaceId: "ws_inbox", subscriberId: "sub_inbox_ws" });
			const result = await repo.create(record);
			expect(result).toMatchObject({ workspaceId: "ws_inbox" });
		});

		it("should set createdAt timestamp on created entry", async () => {
			const record = createInboxRecord();
			const result = await repo.create(record);
			expect(result.createdAt).toBeInstanceOf(Date);
		});
	});

	describe("getAll", () => {
		it("should return all inbox records", async () => {
			await repo.create(createInboxRecord());
			await repo.create(createInboxRecord());
			const all = repo.getAll();
			expect(all).toHaveLength(2);
		});
	});

	describe("findById", () => {
		it("should return item by id", async () => {
			const record = createInboxRecord({ subscriberId: "sub_findbyid" });
			const created = await repo.create(record);
			const found = await repo.findById(created.id);
			expect(found).toMatchObject({ id: created.id, subscriberId: "sub_findbyid" });
		});

		it("should return undefined for unknown id", async () => {
			const result = await repo.findById("inbox_unknown");
			expect(result).toBeUndefined();
		});
	});

	describe("findBySubscriber", () => {
		it("should return items for subscriber", async () => {
			const subscriberId = "sub_list_inbox";
			await repo.create(createInboxRecord({ subscriberId }));
			await repo.create(createInboxRecord({ subscriberId }));
			const result = await repo.findBySubscriber(subscriberId, {});
			expect(result.items).toHaveLength(2);
			expect(result.items.every((r) => r.subscriberId === subscriberId)).toBe(true);
		});

		it("should filter by unread status", async () => {
			const subscriberId = "sub_unread_filter";
			const created = await repo.create(createInboxRecord({ subscriberId }));
			await repo.updateReadAt(created.id);
			await repo.create(createInboxRecord({ subscriberId }));
			const result = await repo.findBySubscriber(subscriberId, { status: "unread" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.readAt).toBeUndefined();
		});

		it("should filter by read status", async () => {
			const subscriberId = "sub_read_filter";
			const created = await repo.create(createInboxRecord({ subscriberId }));
			await repo.updateReadAt(created.id);
			await repo.create(createInboxRecord({ subscriberId }));
			const result = await repo.findBySubscriber(subscriberId, { status: "read" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.readAt).toBeInstanceOf(Date);
		});

		it("should filter by archived status", async () => {
			const subscriberId = "sub_archived_filter";
			const created = await repo.create(createInboxRecord({ subscriberId }));
			await repo.updateArchivedAt(created.id);
			await repo.create(createInboxRecord({ subscriberId }));
			const result = await repo.findBySubscriber(subscriberId, { status: "archived" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.archivedAt).toBeInstanceOf(Date);
		});

		it("should filter by category", async () => {
			const subscriberId = "sub_category_filter";
			await repo.create(createInboxRecord({ subscriberId, category: "transactional" }));
			await repo.create(createInboxRecord({ subscriberId, category: "marketing" }));
			const result = await repo.findBySubscriber(subscriberId, { category: "transactional" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.category).toBe("transactional");
		});
	});

	describe("updateReadAt", () => {
		it("should set readAt on inbox item", async () => {
			const record = createInboxRecord({ subscriberId: "sub_readat" });
			const created = await repo.create(record);
			await repo.updateReadAt(created.id);
			const found = await repo.findById(created.id);
			expect(found?.readAt).toBeInstanceOf(Date);
		});

		it("should throw INBOX_NOT_FOUND for unknown id", async () => {
			await expect(repo.updateReadAt("inbox_nope")).rejects.toMatchObject({
				code: "INBOX_NOT_FOUND",
			});
		});
	});

	describe("updateArchivedAt", () => {
		it("should set archivedAt on inbox item", async () => {
			const record = createInboxRecord({ subscriberId: "sub_archivedat" });
			const created = await repo.create(record);
			await repo.updateArchivedAt(created.id);
			const found = await repo.findById(created.id);
			expect(found?.archivedAt).toBeInstanceOf(Date);
		});

		it("should throw INBOX_NOT_FOUND for unknown id", async () => {
			await expect(repo.updateArchivedAt("inbox_nope")).rejects.toMatchObject({
				code: "INBOX_NOT_FOUND",
			});
		});
	});

	describe("unreadCount", () => {
		it("should return count of unread items for subscriber", async () => {
			const subscriberId = "sub_unread_count";
			const created = await repo.create(createInboxRecord({ subscriberId }));
			await repo.create(createInboxRecord({ subscriberId }));
			await repo.updateReadAt(created.id);
			const count = await repo.unreadCount(subscriberId);
			expect(count).toBe(1);
		});

		it("should return 0 when subscriber has no inbox items", async () => {
			const count = await repo.unreadCount("sub_no_inbox");
			expect(count).toBe(0);
		});
	});

	describe("updateSnoozedUntil", () => {
		it("should set snoozedUntil on inbox item", async () => {
			const record = createInboxRecord({ subscriberId: "sub_snooze" });
			const created = await repo.create(record);
			const snoozeUntil = new Date("2030-01-01T00:00:00Z");
			await repo.updateSnoozedUntil(created.id, snoozeUntil);
			const found = await repo.findById(created.id);
			expect(found?.snoozedUntil).toEqual(snoozeUntil);
		});

		it("should throw INBOX_NOT_FOUND for unknown id", async () => {
			await expect(repo.updateSnoozedUntil("inbox_nope", new Date())).rejects.toMatchObject({
				code: "INBOX_NOT_FOUND",
			});
		});
	});

	describe("markAllRead", () => {
		it("should mark all unread items as read for subscriber", async () => {
			const subscriberId = "sub_mark_all_read";
			await repo.create(createInboxRecord({ subscriberId }));
			await repo.create(createInboxRecord({ subscriberId }));
			await repo.markAllRead(subscriberId);
			const result = await repo.findBySubscriber(subscriberId, { status: "unread" });
			expect(result.items).toHaveLength(0);
		});

		it("should not affect items from other subscribers", async () => {
			const subA = "sub_mark_read_a";
			const subB = "sub_mark_read_b";
			await repo.create(createInboxRecord({ subscriberId: subA }));
			await repo.create(createInboxRecord({ subscriberId: subB }));
			await repo.markAllRead(subA);
			const countB = await repo.unreadCount(subB);
			expect(countB).toBe(1);
		});
	});

	describe("clearReadAt", () => {
		it("should remove readAt from inbox item", async () => {
			const record = createInboxRecord({ subscriberId: "sub_clear_read" });
			const created = await repo.create(record);
			await repo.updateReadAt(created.id);
			await repo.clearReadAt(created.id);
			const found = await repo.findById(created.id);
			expect(found?.readAt).toBeUndefined();
		});

		it("should throw INBOX_NOT_FOUND for unknown id", async () => {
			await expect(repo.clearReadAt("inbox_nope")).rejects.toMatchObject({
				code: "INBOX_NOT_FOUND",
			});
		});
	});

	describe("clearArchivedAt", () => {
		it("should remove archivedAt from inbox item", async () => {
			const record = createInboxRecord({ subscriberId: "sub_clear_archived" });
			const created = await repo.create(record);
			await repo.updateArchivedAt(created.id);
			await repo.clearArchivedAt(created.id);
			const found = await repo.findById(created.id);
			expect(found?.archivedAt).toBeUndefined();
		});

		it("should throw INBOX_NOT_FOUND for unknown id", async () => {
			await expect(repo.clearArchivedAt("inbox_nope")).rejects.toMatchObject({
				code: "INBOX_NOT_FOUND",
			});
		});
	});

	describe("clear", () => {
		it("should remove all inbox records", async () => {
			await repo.create(createInboxRecord());
			repo.clear();
			const all = repo.getAll();
			expect(all).toHaveLength(0);
		});
	});
});

// ---------------------------------------------------------------------------
// PreferenceRepository
// ---------------------------------------------------------------------------

describe("PreferenceRepository", () => {
	let repo: InMemoryPreferenceRepository;

	beforeEach(() => {
		repo = new InMemoryPreferenceRepository();
	});

	describe("upsert", () => {
		it("should create a new preference when none exists", async () => {
			const result = await repo.upsert({
				subscriberId: "sub_upsert",
				topicKey: "alerts",
				channel: "email",
				enabled: true,
				workspaceId: "ws_1",
			});
			expect(result).toMatchObject({
				subscriberId: "sub_upsert",
				topicKey: "alerts",
				channel: "email",
				enabled: true,
			});
		});

		it("should update an existing preference", async () => {
			await repo.upsert({
				subscriberId: "sub_upsert_update",
				topicKey: "alerts",
				channel: "email",
				enabled: true,
				workspaceId: "ws_1",
			});
			const result = await repo.upsert({
				subscriberId: "sub_upsert_update",
				topicKey: "alerts",
				channel: "email",
				enabled: false,
				workspaceId: "ws_1",
			});
			expect(result.enabled).toBe(false);
			const all = await repo.findBySubscriber("sub_upsert_update", {});
			expect(all).toHaveLength(1);
		});

		it("should handle null workspaceId", async () => {
			const result = await repo.upsert({
				subscriberId: "sub_upsert_null_ws",
				topicKey: "general",
				channel: "email",
				enabled: false,
				workspaceId: null,
			});
			expect(result.workspaceId).toBeUndefined();
		});
	});

	describe("reset", () => {
		it("should remove all preferences for subscriber when no workspaceId given", async () => {
			await repo.upsert({
				subscriberId: "sub_reset",
				topicKey: "a",
				channel: "email",
				enabled: true,
				workspaceId: undefined,
			});
			await repo.upsert({
				subscriberId: "sub_reset",
				topicKey: "b",
				channel: "email",
				enabled: true,
				workspaceId: undefined,
			});
			await repo.reset("sub_reset", undefined);
			const all = await repo.findBySubscriber("sub_reset", {});
			expect(all).toHaveLength(0);
		});

		it("should remove only workspace-scoped preferences when workspaceId given", async () => {
			await repo.upsert({
				subscriberId: "sub_reset_ws",
				topicKey: "a",
				channel: "email",
				enabled: true,
				workspaceId: "ws_1",
			});
			await repo.upsert({
				subscriberId: "sub_reset_ws",
				topicKey: "b",
				channel: "email",
				enabled: true,
				workspaceId: undefined,
			});
			await repo.reset("sub_reset_ws", "ws_1");
			const all = await repo.findBySubscriber("sub_reset_ws", {});
			expect(all).toHaveLength(1);
		});

		it("should remove global preferences when workspaceId is null", async () => {
			await repo.upsert({
				subscriberId: "sub_reset_null_ws",
				topicKey: "a",
				channel: "email",
				enabled: true,
				workspaceId: null,
			});
			await repo.upsert({
				subscriberId: "sub_reset_null_ws",
				topicKey: "b",
				channel: "email",
				enabled: true,
				workspaceId: "ws_1",
			});
			await repo.reset("sub_reset_null_ws", null);
			const remaining = await repo.findBySubscriber("sub_reset_null_ws", {});
			expect(remaining).toHaveLength(1);
			expect(remaining[0]?.workspaceId).toBe("ws_1");
		});
	});

	describe("listByWorkspace", () => {
		it("should return all preferences for workspace", async () => {
			const ws = "ws_list_by_workspace";
			await repo.upsert({
				subscriberId: "sub_a",
				topicKey: "x",
				channel: "email",
				enabled: true,
				workspaceId: ws,
			});
			await repo.upsert({
				subscriberId: "sub_b",
				topicKey: "y",
				channel: "email",
				enabled: true,
				workspaceId: ws,
			});
			await repo.upsert({
				subscriberId: "sub_c",
				topicKey: "z",
				channel: "email",
				enabled: true,
				workspaceId: "ws_other",
			});
			const results = await repo.listByWorkspace(ws);
			expect(results).toHaveLength(2);
			expect(results.every((p) => p.workspaceId === ws)).toBe(true);
		});

		it("should return empty array when no preferences for workspace", async () => {
			const results = await repo.listByWorkspace("ws_empty");
			expect(results).toEqual([]);
		});
	});

	describe("listBySubscriber", () => {
		it("should return all preferences for subscriber regardless of workspace", async () => {
			const subscriberId = "sub_list_all";
			await repo.upsert({
				subscriberId,
				topicKey: "a",
				channel: "email",
				enabled: true,
				workspaceId: "ws_1",
			});
			await repo.upsert({
				subscriberId,
				topicKey: "b",
				channel: "sms",
				enabled: false,
				workspaceId: undefined,
			});
			const results = await repo.listBySubscriber(subscriberId);
			expect(results).toHaveLength(2);
		});
	});
});

// ---------------------------------------------------------------------------
// IntegrationRepository
// ---------------------------------------------------------------------------

describe("IntegrationRepository", () => {
	let repo: InMemoryIntegrationRepository;

	beforeEach(() => {
		repo = new InMemoryIntegrationRepository();
	});

	describe("create", () => {
		it("should create an integration and return it with an id", async () => {
			const result = await repo.create({
				ownerId: "ws_1",
				subscriberId: "sub_create_integ",
				name: "My Slack",
				channel: "slack",
				events: null,
				config: { webhookUrl: "https://hooks.slack.com/test" },
			});
			expect(result.id).toBeDefined();
			expect(result).toMatchObject({
				ownerId: "ws_1",
				subscriberId: "sub_create_integ",
				channel: "slack",
				active: true,
			});
		});
	});

	describe("update", () => {
		it("should update integration fields", async () => {
			const created = await repo.create({
				ownerId: "ws_1",
				subscriberId: "sub_update_integ",
				name: "Old Name",
				channel: "slack",
				events: null,
				config: { webhookUrl: "https://old.url" },
			});
			const updated = await repo.update(created.id, { name: "New Name" });
			expect(updated.name).toBe("New Name");
			expect(updated.config).toMatchObject({ webhookUrl: "https://old.url" });
		});

		it("should throw INTEGRATION_NOT_FOUND for unknown id", async () => {
			await expect(repo.update("int_nope", { name: "x" })).rejects.toMatchObject({
				code: "INTEGRATION_NOT_FOUND",
			});
		});
	});

	describe("deactivate", () => {
		it("should set active to false", async () => {
			const created = await repo.create({
				ownerId: "ws_1",
				subscriberId: "sub_deactivate_integ",
				name: null,
				channel: "slack",
				events: null,
				config: {},
			});
			await repo.deactivate(created.id);
			const found = await repo.findById(created.id);
			expect(found?.active).toBe(false);
		});

		it("should throw INTEGRATION_NOT_FOUND for unknown id", async () => {
			await expect(repo.deactivate("int_nope")).rejects.toMatchObject({
				code: "INTEGRATION_NOT_FOUND",
			});
		});
	});

	describe("findById", () => {
		it("should return integration by id", async () => {
			const created = await repo.create({
				ownerId: "ws_1",
				subscriberId: "sub_findbyid_integ",
				name: null,
				channel: "slack",
				events: null,
				config: {},
			});
			const found = await repo.findById(created.id);
			expect(found).toMatchObject({ id: created.id });
		});

		it("should return undefined for unknown id", async () => {
			const found = await repo.findById("int_unknown");
			expect(found).toBeUndefined();
		});
	});

	describe("listByWorkspace", () => {
		it("should return all active integrations for workspace", async () => {
			const ownerId = "ws_list_integ";
			await repo.create({
				ownerId,
				subscriberId: undefined,
				name: null,
				channel: "slack",
				events: null,
				config: {},
			});
			await repo.create({
				ownerId,
				subscriberId: undefined,
				name: null,
				channel: "telegram",
				events: null,
				config: {},
			});
			const deactivated = await repo.create({
				ownerId,
				subscriberId: undefined,
				name: null,
				channel: "slack",
				events: null,
				config: {},
			});
			await repo.deactivate(deactivated.id);
			const results = await repo.listByWorkspace(ownerId);
			expect(results).toHaveLength(2);
		});
	});

	describe("listBySubscriber", () => {
		it("should return active integrations for subscriber", async () => {
			const subscriberId = "sub_list_by_sub";
			await repo.create({
				ownerId: "ws_1",
				subscriberId,
				name: null,
				channel: "slack",
				events: null,
				config: {},
			});
			await repo.create({
				ownerId: "ws_1",
				subscriberId,
				name: null,
				channel: "telegram",
				events: null,
				config: {},
			});
			const results = await repo.listBySubscriber(subscriberId);
			expect(results).toHaveLength(2);
		});
	});
});

// ---------------------------------------------------------------------------
// WorkspaceDefaultRepository
// ---------------------------------------------------------------------------

describe("WorkspaceDefaultRepository", () => {
	let repo: InMemoryWorkspaceDefaultRepository;

	beforeEach(() => {
		repo = new InMemoryWorkspaceDefaultRepository();
	});

	describe("upsert", () => {
		it("should create a new workspace default when none exists", async () => {
			const result = await repo.upsert({
				workspaceId: "ws_upsert",
				topicKey: "alerts",
				channel: "email",
				enabled: true,
				isMandatory: false,
			});
			expect(result).toMatchObject({
				workspaceId: "ws_upsert",
				topicKey: "alerts",
				channel: "email",
				enabled: true,
				isMandatory: false,
			});
		});

		it("should update an existing workspace default", async () => {
			await repo.upsert({
				workspaceId: "ws_upsert_update",
				topicKey: "alerts",
				channel: "email",
				enabled: true,
				isMandatory: false,
			});
			const updated = await repo.upsert({
				workspaceId: "ws_upsert_update",
				topicKey: "alerts",
				channel: "email",
				enabled: false,
				isMandatory: true,
			});
			expect(updated.enabled).toBe(false);
			expect(updated.isMandatory).toBe(true);
			const all = await repo.listByWorkspace("ws_upsert_update");
			expect(all).toHaveLength(1);
		});
	});

	describe("listByWorkspace", () => {
		it("should return all defaults for workspace", async () => {
			const workspaceId = "ws_list_defaults";
			await repo.upsert({
				workspaceId,
				topicKey: "a",
				channel: "email",
				enabled: true,
				isMandatory: false,
			});
			await repo.upsert({
				workspaceId,
				topicKey: "b",
				channel: "sms",
				enabled: true,
				isMandatory: false,
			});
			const results = await repo.listByWorkspace(workspaceId);
			expect(results).toHaveLength(2);
		});
	});
});

// ---------------------------------------------------------------------------
// DeadLetterRepository
// ---------------------------------------------------------------------------

describe("DeadLetterRepository", () => {
	let repo: InMemoryDeadLetterRepository;

	beforeEach(() => {
		repo = new InMemoryDeadLetterRepository();
	});

	function makeDeadLetterData(
		overrides: Partial<{
			notificationId: string;
			subscriberId: string;
			eventType: string;
			channel: string;
		}> = {},
	) {
		return {
			notificationId: `notif_${Math.random().toString(36).slice(2)}`,
			subscriberId: "sub_1",
			eventType: "user.welcome",
			channel: "email",
			attempts: [
				{
					provider: "sendgrid",
					timestamp: new Date(),
					errorCode: "PROVIDER_TIMEOUT",
					errorMessage: "timeout",
				},
			],
			payload: {},
			...overrides,
		};
	}

	describe("findById", () => {
		it("should return dead letter by id", async () => {
			const created = await repo.create(makeDeadLetterData());
			const found = await repo.findById(created.id);
			expect(found).toMatchObject({ id: created.id });
		});

		it("should return null for unknown id", async () => {
			const found = await repo.findById("dlq_nope");
			expect(found).toBeNull();
		});
	});

	describe("list", () => {
		it("should return unresolved dead letters by default", async () => {
			const created = await repo.create(makeDeadLetterData());
			await repo.create(makeDeadLetterData());
			await repo.resolve(created.id, "retried");
			const result = await repo.list();
			expect(result.items).toHaveLength(1);
		});

		it("should include resolved when filter.resolved is true", async () => {
			const created = await repo.create(makeDeadLetterData());
			await repo.resolve(created.id, "retried");
			const result = await repo.list({ resolved: true });
			expect(result.items).toHaveLength(1);
		});

		it("should return empty items for empty store", async () => {
			const result = await repo.list();
			expect(result.items).toHaveLength(0);
			expect(result.hasMore).toBe(false);
		});
	});

	describe("resolve", () => {
		it("should set resolvedAt and resolution on dead letter", async () => {
			const created = await repo.create(makeDeadLetterData());
			await repo.resolve(created.id, "discarded");
			const found = await repo.findById(created.id);
			expect(found?.resolvedAt).toBeInstanceOf(Date);
			expect(found?.resolution).toBe("discarded");
		});

		it("should throw for unknown id", async () => {
			await expect(repo.resolve("dlq_nope", "discarded")).rejects.toThrow("Dead letter not found");
		});
	});

	describe("unresolve", () => {
		it("should clear resolvedAt and resolution on a resolved dead letter", async () => {
			const created = await repo.create(makeDeadLetterData());
			await repo.resolve(created.id, "retried");
			await repo.unresolve(created.id);
			const found = await repo.findById(created.id);
			expect(found?.resolvedAt).toBeUndefined();
			expect(found?.resolution).toBeUndefined();
		});

		it("should resurface the dead letter in the default (unresolved) list", async () => {
			const created = await repo.create(makeDeadLetterData());
			await repo.resolve(created.id, "retried");
			expect((await repo.list()).items).toHaveLength(0);
			await repo.unresolve(created.id);
			expect((await repo.list()).items).toHaveLength(1);
		});

		it("should throw for unknown id", async () => {
			await expect(repo.unresolve("dlq_nope")).rejects.toThrow("Dead letter not found");
		});
	});

	describe("purgeResolved", () => {
		it("should delete only resolved dead letters and return the purged count", async () => {
			const a = await repo.create(makeDeadLetterData());
			await repo.create(makeDeadLetterData());
			const c = await repo.create(makeDeadLetterData());
			await repo.resolve(a.id, "retried");
			await repo.resolve(c.id, "discarded");
			const purged = await repo.purgeResolved();
			expect(purged).toBe(2);
			expect(await repo.findById(a.id)).toBeNull();
			expect(await repo.findById(c.id)).toBeNull();
			expect(await repo.findAllForAdmin()).toHaveLength(1);
		});

		it("should return 0 when nothing is resolved", async () => {
			await repo.create(makeDeadLetterData());
			expect(await repo.purgeResolved()).toBe(0);
		});
	});

	describe("findAllForAdmin", () => {
		it("should return every dead letter newest-first regardless of resolution", async () => {
			const first = await repo.create(makeDeadLetterData());
			const second = await repo.create(makeDeadLetterData());
			await repo.resolve(first.id, "retried");
			const all = await repo.findAllForAdmin();
			expect(all).toHaveLength(2);
			// exhaustedAt is incremented per create, so the second row leads.
			expect(all[0]?.id).toBe(second.id);
			expect(all[1]?.id).toBe(first.id);
		});

		it("should return an empty array for an empty store", async () => {
			expect(await repo.findAllForAdmin()).toEqual([]);
		});
	});
});

// ---------------------------------------------------------------------------
// PushTokenRepository (subscriber Channels tab)
// ---------------------------------------------------------------------------

describe("PushTokenRepository (in-memory)", () => {
	let repo: InMemoryPushTokenRepository;

	beforeEach(() => {
		repo = new InMemoryPushTokenRepository();
	});

	describe("listBySubscriber", () => {
		it("should return a subscriber's tokens newest-first", async () => {
			repo.addToken("tok_old", "sub_1", { createdAt: new Date(1_000) });
			repo.addToken("tok_new", "sub_1", { createdAt: new Date(2_000) });
			repo.addToken("tok_other", "sub_2", { createdAt: new Date(3_000) });
			const tokens = await repo.listBySubscriber("sub_1");
			expect(tokens.map((t) => t.token)).toEqual(["tok_new", "tok_old"]);
		});

		it("should return an empty array for a subscriber with no tokens", async () => {
			expect(await repo.listBySubscriber("sub_none")).toEqual([]);
		});
	});

	describe("deactivateById", () => {
		it("should deactivate the matching token and return true", async () => {
			const record = repo.addToken("tok_1", "sub_1");
			const ok = await repo.deactivateById(record.id, "sub_1");
			expect(ok).toBe(true);
			expect(repo.findByToken("tok_1")?.active).toBe(false);
		});

		it("should be a no-op returning false when the id belongs to another subscriber", async () => {
			const record = repo.addToken("tok_1", "sub_1");
			const ok = await repo.deactivateById(record.id, "sub_other");
			expect(ok).toBe(false);
			expect(repo.findByToken("tok_1")?.active).toBe(true);
		});

		it("should return false for an unknown id", async () => {
			expect(await repo.deactivateById("ptk_nope", "sub_1")).toBe(false);
		});
	});

	describe("deactivateByToken", () => {
		it("should deactivate every record sharing the token value", async () => {
			repo.addToken("tok_dup", "sub_1");
			repo.addToken("tok_dup", "sub_1");
			await repo.deactivateByToken("tok_dup");
			const tokens = await repo.listBySubscriber("sub_1");
			expect(tokens.every((t) => t.active === false)).toBe(true);
		});
	});

	describe("clear", () => {
		it("should drop all seeded tokens", async () => {
			repo.addToken("tok_1", "sub_1");
			repo.clear();
			expect(await repo.listBySubscriber("sub_1")).toEqual([]);
			expect(repo.findByToken("tok_1")).toBeUndefined();
		});
	});
});

// ---------------------------------------------------------------------------
// SuppressionRepository
// ---------------------------------------------------------------------------

describe("SuppressionRepository", () => {
	let repo: InMemorySuppressionRepository;

	beforeEach(() => {
		repo = new InMemorySuppressionRepository();
	});

	describe("findById", () => {
		it("should return suppression by id", async () => {
			const created = await repo.create({
				address: "find@example.com",
				channel: "email",
				reason: "bounce",
				provider: null,
			});
			const found = await repo.findById(created.id);
			expect(found).toMatchObject({ id: created.id, address: "find@example.com" });
		});

		it("should return null for unknown id", async () => {
			const found = await repo.findById("sup_nope");
			expect(found).toBeNull();
		});
	});

	describe("archive", () => {
		it("should archive active suppression and return true", async () => {
			await repo.create({
				address: "archive@example.com",
				channel: "email",
				reason: "bounce",
				provider: null,
			});
			const result = await repo.archive("archive@example.com", "email");
			expect(result).toBe(true);
			const found = await repo.findByAddressAndChannel("archive@example.com", "email");
			expect(found).toBeNull();
		});

		it("should return false when no active suppression exists", async () => {
			const result = await repo.archive("missing@example.com", "email");
			expect(result).toBe(false);
		});
	});

	describe("list", () => {
		it("should return active suppressions by default", async () => {
			const created = await repo.create({
				address: "list1@example.com",
				channel: "email",
				reason: "bounce",
				provider: null,
			});
			await repo.create({
				address: "list2@example.com",
				channel: "email",
				reason: "complaint",
				provider: null,
			});
			await repo.archive("list1@example.com", "email");
			const result = await repo.list();
			expect(result.items).toHaveLength(1);
		});

		it("should include archived when includeArchived is true", async () => {
			await repo.create({
				address: "all1@example.com",
				channel: "email",
				reason: "bounce",
				provider: null,
			});
			const archived = await repo.create({
				address: "all2@example.com",
				channel: "email",
				reason: "complaint",
				provider: null,
			});
			await repo.archive(archived.address, archived.channel);
			const result = await repo.list({ includeArchived: true });
			expect(result.items).toHaveLength(2);
		});

		it("should filter by channel", async () => {
			await repo.create({
				address: "ch1@example.com",
				channel: "email",
				reason: "bounce",
				provider: null,
			});
			await repo.create({
				address: "ch2@example.com",
				channel: "sms",
				reason: "bounce",
				provider: null,
			});
			const result = await repo.list({ channel: "email" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0]?.channel).toBe("email");
		});
	});
});
