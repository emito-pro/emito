import type { Channel } from "@emito/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { routeToIntegrations } from "../src/preferences/integration-router";
import { InMemoryIntegrationRepository } from "../src/repositories/in-memory/in-memory-integration-repository";
import type { IntegrationRecord } from "../src/repositories/types";

// ── Builders ─────────────────────────────────────────────────────────────────

let _idCounter = 0;
function makeIntegration(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
	_idCounter += 1;
	return {
		id: `int_${_idCounter}`,
		ownerId: "ws_1",
		subscriberId: "sub_1", // personal integration by default
		channel: "slack",
		events: undefined, // null = match all events
		config: { webhookUrl: "https://hooks.slack.com/services/T/B/xxx" },
		active: true,
		createdAt: new Date("2026-01-01"),
		...overrides,
	};
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SUBSCRIBER_ID = "sub_1";
const WORKSPACE_ID = "ws_1";
const EVENT_TYPE = "order.filled";
const SLACK: Channel = "slack";
const TELEGRAM: Channel = "telegram";
const DISCORD: Channel = "discord";

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("routeToIntegrations", () => {
	let integrationRepo: InMemoryIntegrationRepository;

	beforeEach(() => {
		_idCounter = 0;
		integrationRepo = new InMemoryIntegrationRepository();
	});

	const deps = () => ({ integrationRepository: integrationRepo });

	// ── No integrations ───────────────────────────────────────────────────────

	describe("no matching integrations", () => {
		it("returns an empty results array when no integrations exist", async () => {
			const result = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver: vi.fn().mockResolvedValue({ status: "delivered" }),
				...deps(),
			});

			expect(result).toEqual([]);
		});

		it("returns empty array when integrations exist for a different channel", async () => {
			integrationRepo.seed(makeIntegration({ channel: TELEGRAM }));

			const result = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver: vi.fn().mockResolvedValue({ status: "delivered" }),
				...deps(),
			});

			expect(result).toEqual([]);
		});

		it("returns empty array when integrations are inactive", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, active: false }));

			const result = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver: vi.fn().mockResolvedValue({ status: "delivered" }),
				...deps(),
			});

			expect(result).toEqual([]);
		});

		it("excludes integrations belonging to a different workspace", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, ownerId: "ws_other" }));

			const result = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver: vi.fn().mockResolvedValue({ status: "delivered" }),
				...deps(),
			});

			expect(result).toEqual([]);
		});
	});

	// ── Workspace-wide vs personal integrations ───────────────────────────────

	describe("workspace-wide and personal integrations", () => {
		it("includes workspace-wide integrations (subscriberId is undefined)", async () => {
			integrationRepo.seed(
				makeIntegration({ channel: SLACK, subscriberId: undefined }), // workspace-wide
			);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
		});

		it("includes personal integrations (subscriberId matches)", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, subscriberId: SUBSCRIBER_ID }));
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
		});

		it("delivers to both workspace-wide and personal integrations concurrently", async () => {
			integrationRepo.seed(
				makeIntegration({ id: "int_workspace", channel: SLACK, subscriberId: undefined }),
			);
			integrationRepo.seed(
				makeIntegration({ id: "int_personal", channel: SLACK, subscriberId: SUBSCRIBER_ID }),
			);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(2);
			expect(results).toHaveLength(2);
			expect(results.every((r) => r.status === "fulfilled")).toBe(true);
		});

		it("excludes personal integrations belonging to a different subscriber", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, subscriberId: "sub_other" }));

			const result = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver: vi.fn().mockResolvedValue({ status: "delivered" }),
				...deps(),
			});

			expect(result).toEqual([]);
		});
	});

	// ── Event type filtering ──────────────────────────────────────────────────

	describe("event type filtering", () => {
		it("integration with events=undefined (null) matches any eventType", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, events: undefined }));
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: "any.event.whatsoever",
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
		});

		it("integration with events=['order.filled'] matches that specific eventType", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, events: ["order.filled"] }));
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: "order.filled",
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
		});

		it("integration with events=['order.filled'] does NOT match a different eventType", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, events: ["order.filled"] }));

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: "security.alert",
				channel: SLACK,
				deliver: vi.fn().mockResolvedValue({ status: "delivered" }),
				...deps(),
			});

			expect(results).toEqual([]);
		});

		it("integration with multiple events matches any of them", async () => {
			integrationRepo.seed(
				makeIntegration({ channel: SLACK, events: ["order.filled", "order.cancelled"] }),
			);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: "order.cancelled",
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
		});

		it("selectively routes: events=null integration AND events-specific integration for same eventType", async () => {
			integrationRepo.seed(
				makeIntegration({
					id: "int_all",
					channel: SLACK,
					events: undefined,
					subscriberId: undefined,
				}),
			);
			integrationRepo.seed(
				makeIntegration({
					id: "int_specific",
					channel: SLACK,
					events: ["order.filled"],
					subscriberId: SUBSCRIBER_ID,
				}),
			);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: "order.filled",
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(2);
			expect(results).toHaveLength(2);
		});

		it("events-specific integration is excluded when eventType does not match, events=null integration still delivers", async () => {
			integrationRepo.seed(
				makeIntegration({
					id: "int_all",
					channel: SLACK,
					events: undefined,
					subscriberId: undefined,
				}),
			);
			integrationRepo.seed(
				makeIntegration({
					id: "int_specific",
					channel: SLACK,
					events: ["order.filled"],
					subscriberId: SUBSCRIBER_ID,
				}),
			);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: "security.alert",
				channel: SLACK,
				deliver,
				...deps(),
			});

			// Only the null-events workspace-wide integration should match
			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
		});
	});

	// ── Concurrent delivery via Promise.allSettled ────────────────────────────

	describe("concurrent delivery to ALL matching integrations", () => {
		it("calls deliver for every matching integration", async () => {
			integrationRepo.seed(
				makeIntegration({ id: "int_1", channel: SLACK, subscriberId: undefined }),
			);
			integrationRepo.seed(
				makeIntegration({ id: "int_2", channel: SLACK, subscriberId: undefined }),
			);
			integrationRepo.seed(
				makeIntegration({ id: "int_3", channel: SLACK, subscriberId: SUBSCRIBER_ID }),
			);

			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(3);
			expect(results).toHaveLength(3);
			expect(results.every((r) => r.status === "fulfilled")).toBe(true);
		});

		it("continues delivering to remaining integrations when one fails (Promise.allSettled)", async () => {
			integrationRepo.seed(
				makeIntegration({ id: "int_success", channel: SLACK, subscriberId: undefined }),
			);
			integrationRepo.seed(
				makeIntegration({ id: "int_failure", channel: SLACK, subscriberId: SUBSCRIBER_ID }),
			);

			const deliver = vi.fn().mockImplementation(async (integration: IntegrationRecord) => {
				if (integration.id === "int_failure") {
					throw new Error("Webhook unreachable");
				}
				return { status: "delivered" };
			});

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(2);
			expect(results).toHaveLength(2);
			expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
			expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
		});

		it("all integrations fail — returns all rejected results without throwing", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, subscriberId: undefined }));
			integrationRepo.seed(makeIntegration({ channel: SLACK, subscriberId: SUBSCRIBER_ID }));

			const deliver = vi.fn().mockRejectedValue(new Error("Network error"));

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(results).toHaveLength(2);
			expect(results.every((r) => r.status === "rejected")).toBe(true);
		});
	});

	// ── Result structure ──────────────────────────────────────────────────────

	describe("result structure", () => {
		it("fulfilled result entries include integrationId and status", async () => {
			const integration = makeIntegration({ channel: SLACK, subscriberId: SUBSCRIBER_ID });
			integrationRepo.seed(integration);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(results[0]).toMatchObject({
				integrationId: integration.id,
				status: "fulfilled",
			});
		});

		it("rejected result entries include integrationId and the error reason", async () => {
			const integration = makeIntegration({ channel: SLACK, subscriberId: SUBSCRIBER_ID });
			integrationRepo.seed(integration);
			const deliver = vi.fn().mockRejectedValue(new Error("Connection refused"));

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(results[0]).toMatchObject({
				integrationId: integration.id,
				status: "rejected",
			});
			expect((results[0] as { status: "rejected"; reason: unknown }).reason).toBeInstanceOf(Error);
		});
	});

	// ── Channel isolation ─────────────────────────────────────────────────────

	describe("channel isolation", () => {
		it("routes only to integrations matching the exact channel", async () => {
			integrationRepo.seed(makeIntegration({ channel: SLACK, subscriberId: SUBSCRIBER_ID }));
			integrationRepo.seed(makeIntegration({ channel: TELEGRAM, subscriberId: SUBSCRIBER_ID }));
			integrationRepo.seed(makeIntegration({ channel: DISCORD, subscriberId: SUBSCRIBER_ID }));

			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			const results = await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: SLACK,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledTimes(1);
			expect(results).toHaveLength(1);
			expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ channel: SLACK }));
		});
	});

	// ── Integration config forwarding ─────────────────────────────────────────

	describe("integration config forwarding", () => {
		it("passes the full integration record to deliver", async () => {
			const integration = makeIntegration({
				channel: TELEGRAM,
				subscriberId: SUBSCRIBER_ID,
				config: { botToken: "123:abc", chatId: "-100123" },
				name: "Trading Bot",
			});
			integrationRepo.seed(integration);
			const deliver = vi.fn().mockResolvedValue({ status: "delivered" });

			await routeToIntegrations({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				eventType: EVENT_TYPE,
				channel: TELEGRAM,
				deliver,
				...deps(),
			});

			expect(deliver).toHaveBeenCalledWith(
				expect.objectContaining({
					id: integration.id,
					channel: TELEGRAM,
					config: { botToken: "123:abc", chatId: "-100123" },
					name: "Trading Bot",
				}),
			);
		});
	});
});
