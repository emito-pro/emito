/**
 * Tests for the 17-status delivery tracking state machine (tracking/state-machine.ts).
 *
 * Covers:
 * - All 17 delivery statuses exist and are tracked
 * - Valid state transitions (pending → sent → delivered, etc.)
 * - Invalid transitions are rejected
 * - Terminal states cannot be transitioned further
 * - Status classification (delivery vs engagement)
 * - Timestamps set correctly per status transition
 * - Status updates persisted correctly to NotificationRepository
 *
 * Rules applied:
 * - rule 4: boundary conditions for all statuses
 * - rule 7: test data builders
 * - rule 12: in-memory repositories for unit tests
 * - rule 25: prefer specific matchers
 * - rule 26: assert on shape of return values, not just existence
 * - rule 28: assert on call arguments for mock verifications
 */

import { classifyStatus, isTerminal } from "@emito/types";
import type { DeliveryStatus } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryNotificationRepository } from "../src/repositories/in-memory/index";
import { canTransition, isDeliveryStatus, transitionStatus } from "../src/tracking/state-machine";
import type { StatusTransitionParams } from "../src/tracking/state-machine";

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

let notifCounter = 0;

function createNotificationId(): string {
	notifCounter++;
	return `notif_track_${notifCounter}`;
}

async function seedNotification(
	repo: InMemoryNotificationRepository,
	status: DeliveryStatus = "pending",
): Promise<string> {
	const id = createNotificationId();
	await repo.create({
		id,
		subscriberId: `sub_${notifCounter}`,
		eventType: "user.welcome",
		category: "transactional",
		channel: "email",
		status,
	});
	return id;
}

function createTransitionParams(
	overrides: Partial<StatusTransitionParams> = {},
): StatusTransitionParams {
	return {
		notificationId: createNotificationId(),
		from: "pending",
		to: "sent",
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Status classification (uses types package helpers)
// ---------------------------------------------------------------------------

describe("DeliveryStatus classification", () => {
	describe("classifyStatus", () => {
		it("should classify pending as delivery", () => {
			expect(classifyStatus("pending")).toBe("delivery");
		});

		it("should classify sent as delivery", () => {
			expect(classifyStatus("sent")).toBe("delivery");
		});

		it("should classify delivered as delivery", () => {
			expect(classifyStatus("delivered")).toBe("delivery");
		});

		it("should classify failed as delivery", () => {
			expect(classifyStatus("failed")).toBe("delivery");
		});

		it("should classify suppressed as delivery", () => {
			expect(classifyStatus("suppressed")).toBe("delivery");
		});

		it("should classify bounced as delivery", () => {
			expect(classifyStatus("bounced")).toBe("delivery");
		});

		it("should classify deferred as delivery", () => {
			expect(classifyStatus("deferred")).toBe("delivery");
		});

		it("should classify digested as delivery", () => {
			expect(classifyStatus("digested")).toBe("delivery");
		});

		it("should classify blocked_by_preference as delivery", () => {
			expect(classifyStatus("blocked_by_preference")).toBe("delivery");
		});

		it("should classify blocked_by_consent as delivery", () => {
			expect(classifyStatus("blocked_by_consent")).toBe("delivery");
		});

		it("should classify blocked_by_admin as delivery", () => {
			expect(classifyStatus("blocked_by_admin")).toBe("delivery");
		});

		it("should classify opened as engagement", () => {
			expect(classifyStatus("opened")).toBe("engagement");
		});

		it("should classify machine_opened as engagement", () => {
			expect(classifyStatus("machine_opened")).toBe("engagement");
		});

		it("should classify clicked as engagement", () => {
			expect(classifyStatus("clicked")).toBe("engagement");
		});

		it("should classify unsubscribed as engagement", () => {
			expect(classifyStatus("unsubscribed")).toBe("engagement");
		});

		it("should classify complained as engagement", () => {
			expect(classifyStatus("complained")).toBe("engagement");
		});

		it("should classify read as engagement", () => {
			expect(classifyStatus("read")).toBe("engagement");
		});
	});

	describe("isTerminal", () => {
		it("should mark delivered as terminal", () => {
			expect(isTerminal("delivered")).toBe(true);
		});

		it("should mark bounced as terminal", () => {
			expect(isTerminal("bounced")).toBe(true);
		});

		it("should mark failed as terminal", () => {
			expect(isTerminal("failed")).toBe(true);
		});

		it("should mark suppressed as terminal", () => {
			expect(isTerminal("suppressed")).toBe(true);
		});

		it("should mark blocked_by_preference as terminal", () => {
			expect(isTerminal("blocked_by_preference")).toBe(true);
		});

		it("should mark blocked_by_consent as terminal", () => {
			expect(isTerminal("blocked_by_consent")).toBe(true);
		});

		it("should mark blocked_by_admin as terminal", () => {
			expect(isTerminal("blocked_by_admin")).toBe(true);
		});

		it("should NOT mark pending as terminal", () => {
			expect(isTerminal("pending")).toBe(false);
		});

		it("should NOT mark sent as terminal", () => {
			expect(isTerminal("sent")).toBe(false);
		});

		it("should NOT mark opened as terminal", () => {
			expect(isTerminal("opened")).toBe(false);
		});

		it("should NOT mark clicked as terminal", () => {
			expect(isTerminal("clicked")).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// canTransition — valid/invalid transition guard
// ---------------------------------------------------------------------------

describe("canTransition", () => {
	// Valid forward transitions
	it("should allow pending → sent", () => {
		expect(canTransition("pending", "sent")).toBe(true);
	});

	it("should allow pending → suppressed", () => {
		expect(canTransition("pending", "suppressed")).toBe(true);
	});

	it("should allow pending → failed", () => {
		expect(canTransition("pending", "failed")).toBe(true);
	});

	it("should allow pending → blocked_by_preference", () => {
		expect(canTransition("pending", "blocked_by_preference")).toBe(true);
	});

	it("should allow pending → blocked_by_consent", () => {
		expect(canTransition("pending", "blocked_by_consent")).toBe(true);
	});

	it("should allow pending → blocked_by_admin", () => {
		expect(canTransition("pending", "blocked_by_admin")).toBe(true);
	});

	it("should allow pending → digested", () => {
		expect(canTransition("pending", "digested")).toBe(true);
	});

	it("should allow sent → delivered", () => {
		expect(canTransition("sent", "delivered")).toBe(true);
	});

	it("should allow sent → bounced", () => {
		expect(canTransition("sent", "bounced")).toBe(true);
	});

	it("should allow sent → deferred", () => {
		expect(canTransition("sent", "deferred")).toBe(true);
	});

	it("should allow sent → failed", () => {
		expect(canTransition("sent", "failed")).toBe(true);
	});

	it("should allow sent → complained", () => {
		expect(canTransition("sent", "complained")).toBe(true);
	});

	it("should allow delivered → opened", () => {
		expect(canTransition("delivered", "opened")).toBe(true);
	});

	it("should allow delivered → machine_opened", () => {
		expect(canTransition("delivered", "machine_opened")).toBe(true);
	});

	it("should allow delivered → clicked", () => {
		expect(canTransition("delivered", "clicked")).toBe(true);
	});

	it("should allow delivered → unsubscribed", () => {
		expect(canTransition("delivered", "unsubscribed")).toBe(true);
	});

	it("should allow delivered → read", () => {
		expect(canTransition("delivered", "read")).toBe(true);
	});

	it("should allow opened → clicked", () => {
		expect(canTransition("opened", "clicked")).toBe(true);
	});

	it("should allow deferred → sent (provider retry succeeded)", () => {
		expect(canTransition("deferred", "sent")).toBe(true);
	});

	it("should allow deferred → bounced (soft bounce became hard)", () => {
		expect(canTransition("deferred", "bounced")).toBe(true);
	});

	// Terminal states cannot transition
	it("should NOT allow delivered → sent (backwards)", () => {
		expect(canTransition("delivered", "sent")).toBe(false);
	});

	it("should NOT allow failed → sent (retry after failure is not allowed through state machine)", () => {
		expect(canTransition("failed", "sent")).toBe(false);
	});

	it("should NOT allow bounced → sent", () => {
		expect(canTransition("bounced", "sent")).toBe(false);
	});

	it("should NOT allow suppressed → sent", () => {
		expect(canTransition("suppressed", "sent")).toBe(false);
	});

	it("should NOT allow blocked_by_preference → sent", () => {
		expect(canTransition("blocked_by_preference", "sent")).toBe(false);
	});

	it("should NOT allow blocked_by_consent → sent", () => {
		expect(canTransition("blocked_by_consent", "sent")).toBe(false);
	});

	it("should NOT allow blocked_by_admin → sent", () => {
		expect(canTransition("blocked_by_admin", "sent")).toBe(false);
	});

	// Same-state transitions
	it("should NOT allow pending → pending (no-op)", () => {
		expect(canTransition("pending", "pending")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// transitionStatus — state machine execution with persistence
// ---------------------------------------------------------------------------

describe("transitionStatus", () => {
	let repo: InMemoryNotificationRepository;

	beforeEach(() => {
		repo = new InMemoryNotificationRepository();
	});

	it("should update the notification status in the repository", async () => {
		const notifId = await seedNotification(repo, "pending");

		await transitionStatus(
			repo,
			createTransitionParams({ notificationId: notifId, from: "pending", to: "sent" }),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.status).toBe("sent");
	});

	it("should set sentAt timestamp when transitioning to sent", async () => {
		const notifId = await seedNotification(repo, "pending");

		await transitionStatus(
			repo,
			createTransitionParams({ notificationId: notifId, from: "pending", to: "sent" }),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.sentAt).toBeInstanceOf(Date);
	});

	it("should set failedAt timestamp when transitioning to failed", async () => {
		const notifId = await seedNotification(repo, "pending");

		await transitionStatus(
			repo,
			createTransitionParams({ notificationId: notifId, from: "pending", to: "failed" }),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.failedAt).toBeInstanceOf(Date);
	});

	it("should set deliveredAt timestamp when transitioning to delivered", async () => {
		const notifId = await seedNotification(repo, "sent");

		await transitionStatus(
			repo,
			createTransitionParams({ notificationId: notifId, from: "sent", to: "delivered" }),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.deliveredAt).toBeInstanceOf(Date);
	});

	it("should set openedAt timestamp when transitioning to opened", async () => {
		const notifId = await seedNotification(repo, "delivered");

		await transitionStatus(
			repo,
			createTransitionParams({ notificationId: notifId, from: "delivered", to: "opened" }),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.openedAt).toBeInstanceOf(Date);
	});

	it("should set clickedAt timestamp when transitioning to clicked", async () => {
		const notifId = await seedNotification(repo, "delivered");

		await transitionStatus(
			repo,
			createTransitionParams({ notificationId: notifId, from: "delivered", to: "clicked" }),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.clickedAt).toBeInstanceOf(Date);
	});

	it("should record provider on the notification when provided", async () => {
		const notifId = await seedNotification(repo, "pending");

		await transitionStatus(
			repo,
			createTransitionParams({
				notificationId: notifId,
				from: "pending",
				to: "sent",
				provider: "resend",
				providerMsgId: "re_abc123",
			}),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.provider).toBe("resend");
		expect(notif?.providerMsgId).toBe("re_abc123");
	});

	it("should throw when attempting an invalid transition", async () => {
		const notifId = await seedNotification(repo, "failed");

		await expect(
			transitionStatus(
				repo,
				createTransitionParams({ notificationId: notifId, from: "failed", to: "sent" }),
			),
		).rejects.toThrow();
	});

	it("should not update the status on invalid transition", async () => {
		const notifId = await seedNotification(repo, "failed");

		try {
			await transitionStatus(
				repo,
				createTransitionParams({ notificationId: notifId, from: "failed", to: "sent" }),
			);
		} catch {
			// expected
		}

		const notif = await repo.findById(notifId);
		expect(notif?.status).toBe("failed");
	});

	it("should store errorMessage when transitioning to failed", async () => {
		const notifId = await seedNotification(repo, "pending");

		await transitionStatus(
			repo,
			createTransitionParams({
				notificationId: notifId,
				from: "pending",
				to: "failed",
				errorMessage: "Provider returned 5xx",
				errorClassification: "transient",
			}),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.errorMessage).toBe("Provider returned 5xx");
		expect(notif?.errorClassification).toBe("transient");
	});

	it("should store errorClassification as permanent on permanent error transition", async () => {
		const notifId = await seedNotification(repo, "pending");

		await transitionStatus(
			repo,
			createTransitionParams({
				notificationId: notifId,
				from: "pending",
				to: "failed",
				errorMessage: "Invalid recipient",
				errorClassification: "permanent",
			}),
		);

		const notif = await repo.findById(notifId);
		expect(notif?.errorClassification).toBe("permanent");
	});

	// ---------------------------------------------------------------------------
	// Full lifecycle sequences
	// ---------------------------------------------------------------------------

	describe("full lifecycle sequences", () => {
		it("should transition through the full email lifecycle: pending → sent → delivered → opened → clicked", async () => {
			const notifId = await seedNotification(repo, "pending");

			await transitionStatus(repo, { notificationId: notifId, from: "pending", to: "sent" });
			await transitionStatus(repo, { notificationId: notifId, from: "sent", to: "delivered" });
			await transitionStatus(repo, { notificationId: notifId, from: "delivered", to: "opened" });
			await transitionStatus(repo, { notificationId: notifId, from: "opened", to: "clicked" });

			const notif = await repo.findById(notifId);
			expect(notif?.status).toBe("clicked");
		});

		it("should handle the failure path: pending → sent → bounced", async () => {
			const notifId = await seedNotification(repo, "pending");

			await transitionStatus(repo, { notificationId: notifId, from: "pending", to: "sent" });
			await transitionStatus(repo, { notificationId: notifId, from: "sent", to: "bounced" });

			const notif = await repo.findById(notifId);
			expect(notif?.status).toBe("bounced");
			expect(isTerminal(notif?.status as DeliveryStatus)).toBe(true);
		});

		it("should handle the suppression path: pending → suppressed", async () => {
			const notifId = await seedNotification(repo, "pending");

			await transitionStatus(repo, { notificationId: notifId, from: "pending", to: "suppressed" });

			const notif = await repo.findById(notifId);
			expect(notif?.status).toBe("suppressed");
			expect(isTerminal(notif?.status as DeliveryStatus)).toBe(true);
		});

		it("should handle deferred then recovery: pending → sent → deferred → sent → delivered", async () => {
			const notifId = await seedNotification(repo, "pending");

			await transitionStatus(repo, { notificationId: notifId, from: "pending", to: "sent" });
			await transitionStatus(repo, { notificationId: notifId, from: "sent", to: "deferred" });
			await transitionStatus(repo, { notificationId: notifId, from: "deferred", to: "sent" });
			await transitionStatus(repo, { notificationId: notifId, from: "sent", to: "delivered" });

			const notif = await repo.findById(notifId);
			expect(notif?.status).toBe("delivered");
		});

		it("should handle admin-blocked: pending → blocked_by_admin", async () => {
			const notifId = await seedNotification(repo, "pending");

			await transitionStatus(repo, {
				notificationId: notifId,
				from: "pending",
				to: "blocked_by_admin",
			});

			const notif = await repo.findById(notifId);
			expect(notif?.status).toBe("blocked_by_admin");
			expect(isTerminal(notif?.status as DeliveryStatus)).toBe(true);
		});

		it("should handle consent-blocked: pending → blocked_by_consent", async () => {
			const notifId = await seedNotification(repo, "pending");

			await transitionStatus(repo, {
				notificationId: notifId,
				from: "pending",
				to: "blocked_by_consent",
			});

			const notif = await repo.findById(notifId);
			expect(notif?.status).toBe("blocked_by_consent");
			expect(isTerminal(notif?.status as DeliveryStatus)).toBe(true);
		});
	});

	// ---------------------------------------------------------------------------
	// All 17 statuses reachable
	// ---------------------------------------------------------------------------

	describe("all 17 delivery statuses are reachable", () => {
		const ALL_STATUSES: DeliveryStatus[] = [
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

		it("should define all 17 delivery statuses", () => {
			expect(ALL_STATUSES).toHaveLength(17);
		});

		it("should correctly classify all 17 statuses without throwing", () => {
			for (const status of ALL_STATUSES) {
				expect(() => classifyStatus(status)).not.toThrow();
			}
		});

		it("should be able to seed a notification with each status via direct create", async () => {
			for (const status of ALL_STATUSES) {
				const id = createNotificationId();
				await repo.create({
					id,
					subscriberId: `sub_${notifCounter}`,
					eventType: "test.event",
					category: "transactional",
					channel: "email",
					status,
				});
				const found = await repo.findById(id);
				expect(found?.status).toBe(status);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// D-032: isDeliveryStatus type guard
// ---------------------------------------------------------------------------

describe("isDeliveryStatus", () => {
	it("should return true for every valid DeliveryStatus value", () => {
		const validStatuses: DeliveryStatus[] = [
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
		for (const status of validStatuses) {
			expect(isDeliveryStatus(status)).toBe(true);
		}
	});

	it("should return false for strings that are not valid DeliveryStatus values", () => {
		expect(isDeliveryStatus("unknown")).toBe(false);
		expect(isDeliveryStatus("DELIVERED")).toBe(false);
		expect(isDeliveryStatus("sent ")).toBe(false);
		expect(isDeliveryStatus("")).toBe(false);
		expect(isDeliveryStatus("queued")).toBe(false);
		expect(isDeliveryStatus("processing")).toBe(false);
	});

	it("should act as a type guard — narrowing string to DeliveryStatus", () => {
		const raw: string = "pending";
		if (isDeliveryStatus(raw)) {
			// TypeScript narrows raw to DeliveryStatus here — canTransition accepts it without cast
			expect(canTransition(raw, "sent")).toBe(true);
		} else {
			expect.fail("isDeliveryStatus should have returned true for 'pending'");
		}
	});

	it("should cover all 17 known statuses — no false negatives", () => {
		// Redundant count assertion — ensures the guard is not accidentally over-narrowing
		const validStatuses = [
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
		expect(validStatuses.every(isDeliveryStatus)).toBe(true);
		expect(validStatuses).toHaveLength(17);
	});
});
