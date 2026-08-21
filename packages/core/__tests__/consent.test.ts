import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { createConsentService } from "../src/consent/service";
import type { ConsentService } from "../src/consent/service";
import { InMemoryConsentRepository } from "../src/repositories/in-memory/in-memory-consent-repository";

describe("InMemoryConsentRepository", () => {
	let repo: InMemoryConsentRepository;

	beforeEach(() => {
		repo = new InMemoryConsentRepository();
	});

	describe("recordConsent", () => {
		it("inserts and returns a record with all fields mapped", async () => {
			const result = await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				topicSlug: "newsletter",
				consented: true,
				ipAddress: "192.168.1.1",
				userAgent: "Mozilla/5.0",
				source: "api",
			});

			expect(result.id).toMatch(/^con_mem_/);
			expect(result.subscriberId).toBe("sub_1");
			expect(result.category).toBe("marketing");
			expect(result.topicSlug).toBe("newsletter");
			expect(result.consented).toBe(true);
			expect(result.ipAddress).toBe("192.168.1.1");
			expect(result.userAgent).toBe("Mozilla/5.0");
			expect(result.source).toBe("api");
			expect(result.createdAt).toBeInstanceOf(Date);
		});

		it("generates unique IDs for each record", async () => {
			const r1 = await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			const r2 = await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: false,
			});

			expect(r1.id).not.toBe(r2.id);
		});
	});

	describe("getLatestConsent", () => {
		it("returns the most recent record for a given subscriber+category", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: false,
			});

			const latest = await repo.getLatestConsent("sub_1", "marketing");
			expect(latest).not.toBeNull();
			expect(latest!.consented).toBe(false);
		});

		it("returns null when no records exist", async () => {
			const result = await repo.getLatestConsent("sub_1", "marketing");
			expect(result).toBeNull();
		});

		it("scopes by subscriber and category", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_2",
				category: "marketing",
				consented: false,
			});

			const sub1 = await repo.getLatestConsent("sub_1", "marketing");
			expect(sub1!.consented).toBe(true);

			const sub2 = await repo.getLatestConsent("sub_2", "marketing");
			expect(sub2!.consented).toBe(false);

			const sub1Product = await repo.getLatestConsent("sub_1", "product");
			expect(sub1Product).toBeNull();
		});
	});

	describe("listConsentHistory", () => {
		it("returns records ordered by createdAt DESC", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "product",
				consented: false,
			});

			const result = await repo.listConsentHistory("sub_1");
			expect(result.items).toHaveLength(2);
			expect(result.items[0].createdAt.getTime()).toBeGreaterThan(
				result.items[1].createdAt.getTime(),
			);
		});

		it("filters by subscriberId", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_2",
				category: "marketing",
				consented: false,
			});

			const result = await repo.listConsentHistory("sub_1");
			expect(result.items).toHaveLength(1);
			expect(result.items[0].subscriberId).toBe("sub_1");
		});

		it("filters by category", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "product",
				consented: false,
			});

			const result = await repo.listConsentHistory("sub_1", { category: "marketing" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0].category).toBe("marketing");
		});

		it("supports cursor pagination", async () => {
			for (let i = 0; i < 5; i++) {
				await repo.recordConsent({
					subscriberId: "sub_1",
					category: "marketing",
					consented: i % 2 === 0,
				});
			}

			const page1 = await repo.listConsentHistory("sub_1", { limit: 2 });
			expect(page1.items).toHaveLength(2);
			expect(page1.hasMore).toBe(true);
			expect(page1.cursor).toBeDefined();

			const page2 = await repo.listConsentHistory("sub_1", {
				limit: 2,
				cursor: page1.cursor,
			});
			expect(page2.items).toHaveLength(2);
			expect(page2.hasMore).toBe(true);

			const page3 = await repo.listConsentHistory("sub_1", {
				limit: 2,
				cursor: page2.cursor,
			});
			expect(page3.items).toHaveLength(1);
			expect(page3.hasMore).toBe(false);
		});
	});

	describe("listAll", () => {
		it("returns records across all subscribers", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_2",
				category: "marketing",
				consented: false,
			});

			const result = await repo.listAll();
			expect(result.items).toHaveLength(2);
		});

		it("filters by subscriberId", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await repo.recordConsent({
				subscriberId: "sub_2",
				category: "marketing",
				consented: false,
			});

			const result = await repo.listAll({ subscriberId: "sub_1" });
			expect(result.items).toHaveLength(1);
			expect(result.items[0].subscriberId).toBe("sub_1");
		});
	});

	describe("seed", () => {
		it("adds a record directly", async () => {
			repo.seed({
				id: "con_seed_1",
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
				createdAt: new Date(),
			});

			const result = await repo.getLatestConsent("sub_1", "marketing");
			expect(result).not.toBeNull();
			expect(result!.id).toBe("con_seed_1");
		});
	});

	describe("clear", () => {
		it("resets the repository", async () => {
			await repo.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});

			repo.clear();

			const result = await repo.getLatestConsent("sub_1", "marketing");
			expect(result).toBeNull();
		});
	});
});

describe("ConsentService", () => {
	let repo: InMemoryConsentRepository;
	let service: ConsentService;

	beforeEach(() => {
		repo = new InMemoryConsentRepository();
		service = createConsentService({ consentRepository: repo });
	});

	describe("recordConsent", () => {
		it("delegates to repository and returns result", async () => {
			const result = await service.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
				source: "api",
			});

			expect(result.subscriberId).toBe("sub_1");
			expect(result.category).toBe("marketing");
			expect(result.consented).toBe(true);
		});

		it("throws VALIDATION_ERROR when subscriberId is empty", async () => {
			try {
				await service.recordConsent({
					subscriberId: "",
					category: "marketing",
					consented: true,
				});
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.VALIDATION_ERROR);
			}
		});

		it("throws VALIDATION_ERROR when category is empty", async () => {
			try {
				await service.recordConsent({
					subscriberId: "sub_1",
					category: "",
					consented: true,
				});
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.VALIDATION_ERROR);
			}
		});
	});

	describe("getLatestConsent", () => {
		it("delegates to repository", async () => {
			await service.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});

			const result = await service.getLatestConsent("sub_1", "marketing");
			expect(result).not.toBeNull();
			expect(result!.consented).toBe(true);
		});
	});

	describe("listHistory", () => {
		it("delegates to repository with subscriberId and filter", async () => {
			await service.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});

			const result = await service.listHistory("sub_1", { category: "marketing" });
			expect(result.items).toHaveLength(1);
		});
	});

	describe("listAll", () => {
		it("delegates to repository", async () => {
			await service.recordConsent({
				subscriberId: "sub_1",
				category: "marketing",
				consented: true,
			});
			await service.recordConsent({
				subscriberId: "sub_2",
				category: "product",
				consented: false,
			});

			const result = await service.listAll();
			expect(result.items).toHaveLength(2);
		});
	});
});
