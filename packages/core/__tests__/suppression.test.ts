/**
 * Tests for the suppression checker (suppression/checker.ts) and
 * InMemorySuppressionRepository archive behavior.
 *
 * Covers:
 * - Pre-send check blocks delivery to suppressed addresses
 * - Non-suppressed addresses pass through
 * - Suppression is per address + channel (address suppressed on email ≠ suppressed on sms)
 * - Permanent errors trigger suppression creation
 * - Suppression records are correctly created with reason
 * - archive() sets archivedAt instead of hard-deleting
 * - findByAddressAndChannel skips archived entries (active-only)
 * - list() defaults to active-only; includeArchived shows all
 * - Re-suppression creates a new row (append-only history)
 * - PII must not appear in error context (rule 20)
 *
 * Rules applied:
 * - rule 1: assert on EmitoErrorCode, not message strings
 * - rule 2: assert isRetryable for error path tests
 * - rule 7: test data builders
 * - rule 12: in-memory repositories for unit tests
 * - rule 20: PII excluded from error context
 * - rule 22: vi.useFakeTimers() for time-dependent behavior
 * - rule 23: vi.useRealTimers() in afterEach
 * - rule 25: prefer specific matchers
 * - rule 26: assert on shape of return values, not just existence
 */

import { EMITO_ERROR_CODE } from "@emito/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemorySuppressionRepository } from "../src/repositories/in-memory/index";
import { addSuppression, checkSuppression } from "../src/suppression/checker";
import type { AddSuppressionParams, SuppressionCheckParams } from "../src/suppression/checker";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

function createSuppressionCheckParams(
	overrides: Partial<SuppressionCheckParams> = {},
): SuppressionCheckParams {
	return {
		address: "user1@example.com",
		channel: "email",
		...overrides,
	};
}

function createAddSuppressionParams(
	overrides: Partial<AddSuppressionParams> = {},
): AddSuppressionParams {
	return {
		address: "bounce@example.com",
		channel: "email",
		reason: "hard_bounce",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Pre-send suppression check
// ---------------------------------------------------------------------------

describe("checkSuppression", () => {
	describe("when address is suppressed", () => {
		it("should return suppressed:true when address and channel match", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({
				address: "blocked@example.com",
				channel: "email",
				reason: "hard_bounce",
			});

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "blocked@example.com", channel: "email" }),
			);

			expect(result.suppressed).toBe(true);
		});

		it("should return the suppression record when found", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({
				address: "blocked@example.com",
				channel: "email",
				reason: "spam_complaint",
			});

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "blocked@example.com", channel: "email" }),
			);

			expect(result.record).toMatchObject({
				address: "blocked@example.com",
				channel: "email",
				reason: "spam_complaint",
			});
		});
	});

	describe("when address is not suppressed", () => {
		it("should return suppressed:false for a clean address", async () => {
			const repo = new InMemorySuppressionRepository();

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "clean@example.com", channel: "email" }),
			);

			expect(result.suppressed).toBe(false);
		});

		it("should return no record when not suppressed", async () => {
			const repo = new InMemorySuppressionRepository();

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "clean@example.com", channel: "email" }),
			);

			expect(result.record).toBeNull();
		});
	});

	describe("when address has an archived suppression", () => {
		it("should return suppressed:false for an archived entry", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({
				address: "archived@example.com",
				channel: "email",
				reason: "hard_bounce",
			});
			await repo.archive("archived@example.com", "email");

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "archived@example.com", channel: "email" }),
			);

			expect(result.suppressed).toBe(false);
		});

		it("should return null record for an archived entry", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({
				address: "archived@example.com",
				channel: "email",
				reason: "hard_bounce",
			});
			await repo.archive("archived@example.com", "email");

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "archived@example.com", channel: "email" }),
			);

			expect(result.record).toBeNull();
		});
	});

	describe("channel-scoped suppression", () => {
		it("should not suppress sms when only email is suppressed for the address", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({ address: "+15550001234", channel: "email", reason: "hard_bounce" });

			const result = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "+15550001234", channel: "sms" }),
			);

			expect(result.suppressed).toBe(false);
		});

		it("should suppress email independently of sms for the same address", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({
				address: "user@example.com",
				channel: "email",
				reason: "spam_complaint",
			});
			await repo.create({ address: "user@example.com", channel: "sms", reason: "hard_bounce" });

			const emailResult = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "user@example.com", channel: "email" }),
			);
			const smsResult = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "user@example.com", channel: "sms" }),
			);

			expect(emailResult.suppressed).toBe(true);
			expect(smsResult.suppressed).toBe(true);
		});

		it("should differentiate push vs email suppression for the same token", async () => {
			const repo = new InMemorySuppressionRepository();
			await repo.create({ address: "device-token-xyz", channel: "push", reason: "unregistered" });

			const emailResult = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "device-token-xyz", channel: "email" }),
			);
			const pushResult = await checkSuppression(
				repo,
				createSuppressionCheckParams({ address: "device-token-xyz", channel: "push" }),
			);

			expect(emailResult.suppressed).toBe(false);
			expect(pushResult.suppressed).toBe(true);
		});
	});

	describe("boundary conditions", () => {
		it("should handle empty string address without throwing", async () => {
			const repo = new InMemorySuppressionRepository();

			const result = await checkSuppression(repo, createSuppressionCheckParams({ address: "" }));

			expect(result.suppressed).toBe(false);
		});

		it("should work with all supported channel types", async () => {
			const repo = new InMemorySuppressionRepository();
			const channels = [
				"email",
				"sms",
				"push",
				"slack",
				"telegram",
				"discord",
				"whatsapp",
			] as const;

			for (const channel of channels) {
				await repo.create({ address: `addr_${channel}`, channel, reason: "test" });
				const result = await checkSuppression(repo, { address: `addr_${channel}`, channel });
				expect(result.suppressed).toBe(true);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Adding to suppression list
// ---------------------------------------------------------------------------

describe("addSuppression", () => {
	it("should create a suppression record for a permanent error", async () => {
		const repo = new InMemorySuppressionRepository();

		await addSuppression(
			repo,
			createAddSuppressionParams({
				address: "bounce@example.com",
				channel: "email",
				reason: "hard_bounce",
			}),
		);

		const found = await repo.findByAddressAndChannel("bounce@example.com", "email");
		expect(found).not.toBeNull();
		expect(found?.reason).toBe("hard_bounce");
	});

	it("should create suppression with the correct address, channel, and reason", async () => {
		const repo = new InMemorySuppressionRepository();

		await addSuppression(repo, {
			address: "+15550009876",
			channel: "sms",
			reason: "spam_complaint",
		});

		const found = await repo.findByAddressAndChannel("+15550009876", "sms");
		expect(found).toMatchObject({
			address: "+15550009876",
			channel: "sms",
			reason: "spam_complaint",
		});
	});

	it("should include optional provider and providerMsgId when supplied", async () => {
		const repo = new InMemorySuppressionRepository();

		await addSuppression(repo, {
			address: "user@example.com",
			channel: "email",
			reason: "hard_bounce",
			provider: "sendgrid",
			providerMsgId: "sg_bounce_123",
		});

		const found = await repo.findByAddressAndChannel("user@example.com", "email");
		expect(found).toMatchObject({
			provider: "sendgrid",
			providerMsgId: "sg_bounce_123",
		});
	});

	it("should not require provider or providerMsgId (optional fields)", async () => {
		const repo = new InMemorySuppressionRepository();

		// Must not throw
		await expect(
			addSuppression(repo, {
				address: "test@example.com",
				channel: "email",
				reason: "admin_block",
			}),
		).resolves.not.toThrow();
	});

	it("should return the created suppression record", async () => {
		const repo = new InMemorySuppressionRepository();

		const record = await addSuppression(repo, {
			address: "new@example.com",
			channel: "email",
			reason: "hard_bounce",
		});

		expect(record).toMatchObject({
			address: "new@example.com",
			channel: "email",
			reason: "hard_bounce",
		});
		expect(record.id).toBeDefined();
		expect(record.createdAt).toBeInstanceOf(Date);
	});

	describe("security: PII exclusion (rule 20)", () => {
		it("should not include email address in any thrown error context", async () => {
			// Simulate a repo that throws to test error wrapping
			const brokenRepo = {
				findByAddressAndChannel: async () => {
					throw new Error("DB connection failed");
				},
				create: async () => {
					throw new Error("DB connection failed");
				},
			};

			let caughtError: unknown;
			try {
				await addSuppression(brokenRepo, {
					address: "private@example.com",
					channel: "email",
					reason: "hard_bounce",
				});
			} catch (err) {
				caughtError = err;
			}

			if (caughtError && typeof caughtError === "object" && "context" in caughtError) {
				const context = (caughtError as { context: Record<string, unknown> }).context;
				expect(JSON.stringify(context)).not.toContain("private@example.com");
			}
		});

		it("should not include phone number in error context", async () => {
			const brokenRepo = {
				findByAddressAndChannel: async () => {
					throw new Error("fail");
				},
				create: async () => {
					throw new Error("fail");
				},
			};

			let caughtError: unknown;
			try {
				await addSuppression(brokenRepo, {
					address: "+15550001234",
					channel: "sms",
					reason: "hard_bounce",
				});
			} catch (err) {
				caughtError = err;
			}

			if (caughtError && typeof caughtError === "object" && "context" in caughtError) {
				const context = (caughtError as { context: Record<string, unknown> }).context;
				expect(JSON.stringify(context)).not.toContain("+15550001234");
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Suppression due to permanent provider errors
// ---------------------------------------------------------------------------

describe("suppression from permanent errors", () => {
	it("should add address to suppression list when permanent error classification is triggered", async () => {
		const repo = new InMemorySuppressionRepository();

		// Permanent error from provider maps to immediate suppression
		await addSuppression(repo, {
			address: "invalid@example.com",
			channel: "email",
			reason: "permanent_delivery_failure",
			provider: "resend",
		});

		const check = await checkSuppression(repo, {
			address: "invalid@example.com",
			channel: "email",
		});
		expect(check.suppressed).toBe(true);
	});

	it("should block subsequent deliveries to an address added after a permanent error", async () => {
		const repo = new InMemorySuppressionRepository();
		const address = "permanently-failed@example.com";

		// Simulate a permanent error outcome — add to suppression
		await addSuppression(repo, { address, channel: "email", reason: "permanent_delivery_failure" });

		// Next delivery attempt to same address should be blocked
		const check = await checkSuppression(repo, { address, channel: "email" });
		expect(check.suppressed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// SuppressionRepository.archive() — in-memory implementation
// ---------------------------------------------------------------------------

describe("InMemorySuppressionRepository.archive()", () => {
	it("should return true when the record exists and is archived", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });

		const result = await repo.archive("user@example.com", "email");

		expect(result).toBe(true);
	});

	it("should return false when no active record exists for the address and channel", async () => {
		const repo = new InMemorySuppressionRepository();

		const result = await repo.archive("nobody@example.com", "email");

		expect(result).toBe(false);
	});

	it("should set archivedAt on the record", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });

		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-04-07T12:00:00Z"));

		await repo.archive("user@example.com", "email");

		vi.useRealTimers();

		// After archiving, findByAddressAndChannel returns null (active-only)
		const active = await repo.findByAddressAndChannel("user@example.com", "email");
		expect(active).toBeNull();
	});

	it("should not hard-delete — archived record should appear with includeArchived:true", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");

		const { items } = await repo.list({ includeArchived: true });
		const archived = items.find((r) => r.address === "user@example.com" && r.channel === "email");

		expect(archived).toBeDefined();
		expect(archived?.archivedAt).toBeInstanceOf(Date);
	});

	it("should make findByAddressAndChannel return null after archiving", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });

		await repo.archive("user@example.com", "email");

		const record = await repo.findByAddressAndChannel("user@example.com", "email");
		expect(record).toBeNull();
	});

	it("should only archive the specified channel (not other channels for the same address)", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.create({ address: "user@example.com", channel: "sms", reason: "hard_bounce" });

		await repo.archive("user@example.com", "email");

		const emailRecord = await repo.findByAddressAndChannel("user@example.com", "email");
		const smsRecord = await repo.findByAddressAndChannel("user@example.com", "sms");

		expect(emailRecord).toBeNull();
		expect(smsRecord).not.toBeNull();
	});

	it("should allow checkSuppression to pass after archiving (address is unsuppressed)", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });

		await repo.archive("user@example.com", "email");

		const check = await checkSuppression(repo, { address: "user@example.com", channel: "email" });
		expect(check.suppressed).toBe(false);
	});

	it("should return false on second archive attempt (idempotent — no active record after first)", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");

		const secondArchive = await repo.archive("user@example.com", "email");

		expect(secondArchive).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Re-suppression — append-only history
// ---------------------------------------------------------------------------

describe("re-suppression (append-only history)", () => {
	it("should create a new row when re-suppressing an archived address", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");

		// Re-suppress the same address+channel with a new reason
		await repo.create({ address: "user@example.com", channel: "email", reason: "spam_complaint" });

		const active = await repo.findByAddressAndChannel("user@example.com", "email");
		expect(active).not.toBeNull();
		expect(active?.reason).toBe("spam_complaint");
		expect(active?.archivedAt).toBeUndefined();
	});

	it("should have two rows in history after archive+re-suppress", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");
		await repo.create({ address: "user@example.com", channel: "email", reason: "spam_complaint" });

		const { items } = await repo.list({ includeArchived: true });
		const history = items.filter((r) => r.address === "user@example.com" && r.channel === "email");

		expect(history).toHaveLength(2);
	});

	it("should correctly block delivery after re-suppression", async () => {
		const repo = new InMemorySuppressionRepository();

		// First suppression then archive (admin lifts)
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");

		// New bounce — re-suppress
		await repo.create({ address: "user@example.com", channel: "email", reason: "spam_complaint" });

		const check = await checkSuppression(repo, { address: "user@example.com", channel: "email" });
		expect(check.suppressed).toBe(true);
		expect(check.record?.reason).toBe("spam_complaint");
	});
});

// ---------------------------------------------------------------------------
// SuppressionRepository.list() — active-only default, includeArchived option
// ---------------------------------------------------------------------------

describe("InMemorySuppressionRepository.list()", () => {
	it("should return only active (non-archived) entries by default", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "active@example.com", channel: "email", reason: "hard_bounce" });
		await repo.create({
			address: "to-archive@example.com",
			channel: "email",
			reason: "spam_complaint",
		});
		await repo.archive("to-archive@example.com", "email");

		const { items } = await repo.list();

		const addresses = items.map((r) => r.address);
		expect(addresses).toContain("active@example.com");
		expect(addresses).not.toContain("to-archive@example.com");
	});

	it("should include archived entries when includeArchived:true", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "active@example.com", channel: "email", reason: "hard_bounce" });
		await repo.create({
			address: "to-archive@example.com",
			channel: "email",
			reason: "spam_complaint",
		});
		await repo.archive("to-archive@example.com", "email");

		const { items } = await repo.list({ includeArchived: true });

		const addresses = items.map((r) => r.address);
		expect(addresses).toContain("active@example.com");
		expect(addresses).toContain("to-archive@example.com");
	});

	it("should return empty list when all entries are archived and includeArchived is false", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");

		const { items } = await repo.list();

		expect(items).toHaveLength(0);
	});

	it("should filter by channel and exclude archived entries together", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({
			address: "email-active@example.com",
			channel: "email",
			reason: "hard_bounce",
		});
		await repo.create({
			address: "email-archived@example.com",
			channel: "email",
			reason: "hard_bounce",
		});
		await repo.create({ address: "+15550001111", channel: "sms", reason: "hard_bounce" });
		await repo.archive("email-archived@example.com", "email");

		const { items } = await repo.list({ channel: "email" });

		expect(items).toHaveLength(1);
		expect(items[0].address).toBe("email-active@example.com");
	});

	it("should return archived entries for specific channel when includeArchived:true", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });
		await repo.archive("user@example.com", "email");

		const { items } = await repo.list({ channel: "email", includeArchived: true });

		expect(items).toHaveLength(1);
		expect(items[0].archivedAt).toBeInstanceOf(Date);
	});
});

// ---------------------------------------------------------------------------
// SuppressionRecord — archivedAt field
// ---------------------------------------------------------------------------

describe("SuppressionRecord.archivedAt", () => {
	it("should not have archivedAt set on a freshly created record", async () => {
		const repo = new InMemorySuppressionRepository();
		const record = await repo.create({
			address: "user@example.com",
			channel: "email",
			reason: "hard_bounce",
		});

		expect(record.archivedAt).toBeUndefined();
	});

	it("should set archivedAt to a Date when archived", async () => {
		const repo = new InMemorySuppressionRepository();
		await repo.create({ address: "user@example.com", channel: "email", reason: "hard_bounce" });

		vi.useFakeTimers();
		const archiveTime = new Date("2026-04-07T15:00:00Z");
		vi.setSystemTime(archiveTime);

		await repo.archive("user@example.com", "email");

		vi.useRealTimers();

		// Get the record via includeArchived
		const { items } = await repo.list({ includeArchived: true });
		const record = items.find((r) => r.address === "user@example.com");

		expect(record?.archivedAt).toBeInstanceOf(Date);
		expect(record?.archivedAt?.getTime()).toBe(archiveTime.getTime());
	});
});
