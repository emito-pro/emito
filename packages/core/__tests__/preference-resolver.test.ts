import type {
	Channel,
	EventDefinition,
	PreferenceRecord,
	PreferenceTier,
	WorkspaceDefault,
} from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { resolvePreferences } from "../src/preferences/resolver";
import { InMemoryPreferenceRepository } from "../src/repositories/in-memory/in-memory-preference-repository";
import { InMemoryWorkspaceDefaultRepository } from "../src/repositories/in-memory/in-memory-workspace-default-repository";

// ── Builders ────────────────────────────────────────────────────────────────

function makePreference(overrides: Partial<PreferenceRecord> = {}): PreferenceRecord {
	return {
		subscriberId: "sub_1",
		topicKey: "newsletter",
		channel: "email",
		enabled: true,
		...overrides,
	};
}

function makeWorkspaceDefault(overrides: Partial<WorkspaceDefault> = {}): WorkspaceDefault {
	return {
		workspaceId: "ws_1",
		topicKey: "newsletter",
		channel: "email",
		enabled: true,
		isMandatory: false,
		...overrides,
	};
}

function makeEventDefinition(overrides: Partial<EventDefinition> = {}): EventDefinition {
	return {
		category: "product",
		channels: ["email", "sms"],
		...overrides,
	};
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SUBSCRIBER_ID = "sub_1";
const WORKSPACE_ID = "ws_1";
const TOPIC_KEY = "newsletter";
const EMAIL: Channel = "email";
const SMS: Channel = "sms";
const PUSH: Channel = "push";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("resolvePreferences", () => {
	let preferenceRepo: InMemoryPreferenceRepository;
	let workspaceDefaultRepo: InMemoryWorkspaceDefaultRepository;

	beforeEach(() => {
		preferenceRepo = new InMemoryPreferenceRepository();
		workspaceDefaultRepo = new InMemoryWorkspaceDefaultRepository();
	});

	const deps = () => ({
		preferenceRepository: preferenceRepo,
		workspaceDefaultRepository: workspaceDefaultRepo,
	});

	// ── Tier 1: Workspace admin hard-block / force ───────────────────────────

	describe("Tier 1: workspace admin mandatory setting", () => {
		it("blocks channel when isMandatory=true and enabled=false, user workspace preference is ignored", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: true }));
			// User has workspace-scoped preference that says enabled=true — must be overridden
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: true }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("workspace_admin_block");
		});

		it("force-enables channel when isMandatory=true and enabled=true, user workspace preference is ignored", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: true, isMandatory: true }));
			// User has workspace-scoped preference that says enabled=false — must be overridden
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(true);
			expect(result.tier).toBe<PreferenceTier>("workspace_admin_block");
		});

		it("does not apply mandatory override when isMandatory=false and enabled=false", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: false }));
			// No user preference seeded — resolves to workspace default (tier 3)
			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("workspace_default");
			expect(result.enabled).toBe(false);
		});

		it("mandatory override applies per-channel independently", async () => {
			workspaceDefaultRepo.seed(
				makeWorkspaceDefault({ channel: EMAIL, enabled: false, isMandatory: true }),
			);
			workspaceDefaultRepo.seed(
				makeWorkspaceDefault({ channel: SMS, enabled: true, isMandatory: false }),
			);

			const emailResult = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			const smsResult = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: SMS,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(emailResult.tier).toBe<PreferenceTier>("workspace_admin_block");
			expect(emailResult.enabled).toBe(false);
			expect(smsResult.tier).not.toBe<PreferenceTier>("workspace_admin_block");
		});
	});

	// ── Tier 2: User's workspace-scoped preference ───────────────────────────

	describe("Tier 2: user workspace-scoped preference", () => {
		it("uses workspace-scoped preference when present and no mandatory override", async () => {
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("user_workspace");
		});

		it("workspace-scoped preference enabled=true overrides workspace default enabled=false", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false }));
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: true }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(true);
			expect(result.tier).toBe<PreferenceTier>("user_workspace");
		});

		it("workspace-scoped preference takes priority over global user preference (tier 4)", async () => {
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: false })); // global
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: true })); // workspace-scoped

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(true);
			expect(result.tier).toBe<PreferenceTier>("user_workspace");
		});
	});

	// ── Tier 3: Workspace admin default ─────────────────────────────────────

	describe("Tier 3: workspace admin default", () => {
		it("uses workspace default when no user workspace-scoped preference exists", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("workspace_default");
		});

		it("workspace default takes priority over global user preference (tier 4)", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false }));
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: true })); // global

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("workspace_default");
		});
	});

	// ── Tier 4: User's global preference ────────────────────────────────────

	describe("Tier 4: user global preference", () => {
		it("uses global preference when no workspace-scoped data exists", async () => {
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("user_global");
		});

		it("applies global preference when workspaceId is not provided", async () => {
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("user_global");
		});

		it("global preference for a different channel does not affect current channel", async () => {
			preferenceRepo.seed(makePreference({ channel: SMS, workspaceId: undefined, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: ["email", "sms"] }),
				...deps(),
			});

			// Email has no preference — falls through to system default
			expect(result.tier).toBe<PreferenceTier>("system_default");
			expect(result.enabled).toBe(true);
		});
	});

	// ── Tier 5: System default from event definition ─────────────────────────

	describe("Tier 5: system default", () => {
		it("enables channel when it is listed in event.channels and no other tier resolved", async () => {
			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.enabled).toBe(true);
			expect(result.tier).toBe<PreferenceTier>("system_default");
		});

		it("disables channel when it is NOT listed in event.channels", async () => {
			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: PUSH,
				eventDefinition: makeEventDefinition({ channels: [EMAIL, SMS] }),
				...deps(),
			});

			expect(result.enabled).toBe(false);
			expect(result.tier).toBe<PreferenceTier>("system_default");
		});
	});

	// ── bypassPreferences: skips tiers 1-4 ──────────────────────────────────

	describe("bypassPreferences=true on EventDefinition", () => {
		it("skips all preference tiers and delivers based solely on event.channels", async () => {
			// Tier 1: mandatory block
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: true }));
			// Tier 2: user workspace preference
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: false }));
			// Tier 4: user global preference
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL], bypassPreferences: true }),
				...deps(),
			});

			// Must be enabled because bypassPreferences skips all tiers; channel is in event.channels
			expect(result.enabled).toBe(true);
		});

		it("still disables channel not in event.channels even with bypassPreferences=true", async () => {
			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: PUSH,
				eventDefinition: makeEventDefinition({ channels: [EMAIL], bypassPreferences: true }),
				...deps(),
			});

			expect(result.enabled).toBe(false);
		});
	});

	// ── Priority order: tiers 1 > 2 > 3 > 4 > 5 ────────────────────────────

	describe("priority order across all tiers", () => {
		it("tier 1 beats tier 2 when tier 1 is mandatory", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: true }));
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: true }));
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: true }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("workspace_admin_block");
			expect(result.enabled).toBe(false);
		});

		it("tier 2 beats tier 3 when tier 2 is present", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false }));
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: true }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("user_workspace");
			expect(result.enabled).toBe(true);
		});

		it("tier 3 beats tier 4 when tier 3 is present and tier 2 is absent", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false }));
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: true })); // global (tier 4)

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition(),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("workspace_default");
			expect(result.enabled).toBe(false);
		});

		it("tier 4 beats tier 5 when global preference exists", async () => {
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("user_global");
			expect(result.enabled).toBe(false);
		});

		it("full priority chain: all tiers seeded — tier 1 wins", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: true }));
			preferenceRepo.seed(makePreference({ workspaceId: WORKSPACE_ID, enabled: true }));
			preferenceRepo.seed(makePreference({ workspaceId: undefined, enabled: true }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("workspace_admin_block");
			expect(result.enabled).toBe(false);
		});
	});

	// ── No workspaceId: workspace tiers (1-3) are skipped ───────────────────

	describe("without workspaceId (only tiers 4-5 apply)", () => {
		it("skips workspace mandatory override when workspaceId is undefined", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: true }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).not.toBe<PreferenceTier>("workspace_admin_block");
			expect(result.enabled).toBe(true);
		});

		it("skips workspace default when workspaceId is undefined", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ enabled: false, isMandatory: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).not.toBe<PreferenceTier>("workspace_default");
			expect(result.tier).toBe<PreferenceTier>("system_default");
			expect(result.enabled).toBe(true);
		});
	});

	// ── Topic scoping ────────────────────────────────────────────────────────

	describe("topic scoping", () => {
		it("preference for a different topic does not resolve for current topic", async () => {
			preferenceRepo.seed(
				makePreference({ topicKey: "other-topic", workspaceId: undefined, enabled: false }),
			);

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("system_default");
			expect(result.enabled).toBe(true);
		});

		it("workspace default for a different topic is not applied", async () => {
			workspaceDefaultRepo.seed(makeWorkspaceDefault({ topicKey: "other-topic", enabled: false }));

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: WORKSPACE_ID,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("system_default");
		});
	});

	// ── Subscriber scoping ───────────────────────────────────────────────────

	describe("subscriber scoping", () => {
		it("preference for a different subscriber does not resolve for current subscriber", async () => {
			preferenceRepo.seed(
				makePreference({ subscriberId: "sub_2", workspaceId: undefined, enabled: false }),
			);

			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result.tier).toBe<PreferenceTier>("system_default");
			expect(result.enabled).toBe(true);
		});
	});

	// ── Result shape ─────────────────────────────────────────────────────────

	describe("result structure", () => {
		it("returns PreferenceResolutionResult with enabled and tier fields", async () => {
			const result = await resolvePreferences({
				subscriberId: SUBSCRIBER_ID,
				workspaceId: undefined,
				topicKey: TOPIC_KEY,
				channel: EMAIL,
				eventDefinition: makeEventDefinition({ channels: [EMAIL] }),
				...deps(),
			});

			expect(result).toMatchObject({
				enabled: expect.any(Boolean),
				tier: expect.stringMatching(
					/^(workspace_admin_block|user_workspace|workspace_default|user_global|system_default)$/,
				),
			});
		});
	});
});
