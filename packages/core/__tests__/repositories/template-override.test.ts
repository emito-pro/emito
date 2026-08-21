import { beforeEach, describe, expect, it } from "vitest";
import type { TemplateOverrideCreate } from "../../src/index";
import { InMemoryTemplateOverrideRepository } from "../../src/index";

function input(overrides: Partial<TemplateOverrideCreate> = {}): TemplateOverrideCreate {
	return {
		eventKey: "user.welcome",
		channel: "email",
		locale: "en",
		source: "<h1>Hello</h1>",
		createdByUserId: "user_1",
		updatedByUserId: "user_1",
		...overrides,
	};
}

describe("InMemoryTemplateOverrideRepository", () => {
	let repo: InMemoryTemplateOverrideRepository;

	beforeEach(() => {
		repo = new InMemoryTemplateOverrideRepository();
	});

	it("create starts version at 1 for a new triple", async () => {
		const record = await repo.create(input());
		expect(record.id).toMatch(/^tmo_mem_/);
		expect(record.version).toBe(1);
		expect(record.compiledWarning).toBeNull();
	});

	it("create auto-bumps version per (event, channel, locale)", async () => {
		await repo.create(input({ source: "v1" }));
		const v2 = await repo.create(input({ source: "v2" }));
		const v3 = await repo.create(input({ source: "v3" }));
		expect(v2.version).toBe(2);
		expect(v3.version).toBe(3);
	});

	it("create versions are independent across triples", async () => {
		const en = await repo.create(input({ locale: "en" }));
		const pl = await repo.create(input({ locale: "pl" }));
		expect(en.version).toBe(1);
		expect(pl.version).toBe(1);
	});

	it("findActive returns the highest version for a triple, null when absent", async () => {
		await repo.create(input({ source: "v1" }));
		const v2 = await repo.create(input({ source: "v2" }));
		const active = await repo.findActive("user.welcome", "email", "en");
		expect(active?.id).toBe(v2.id);
		expect(active?.version).toBe(2);
		expect(await repo.findActive("user.welcome", "sms", "en")).toBeNull();
	});

	it("create preserves a compiledWarning", async () => {
		const record = await repo.create(input({ compiledWarning: "unclosed tag" }));
		expect(record.compiledWarning).toBe("unclosed tag");
	});

	it("history returns newest-version-first, capped at limit", async () => {
		await repo.create(input({ source: "v1" }));
		await repo.create(input({ source: "v2" }));
		await repo.create(input({ source: "v3" }));

		const all = await repo.history("user.welcome", "email", "en", 10);
		expect(all.map((r) => r.version)).toEqual([3, 2, 1]);

		const capped = await repo.history("user.welcome", "email", "en", 2);
		expect(capped.map((r) => r.version)).toEqual([3, 2]);
	});

	it("listGallery returns one present-custom cell per distinct triple", async () => {
		await repo.create(input({ locale: "en", source: "v1" }));
		await repo.create(input({ locale: "en", source: "v2" }));
		await repo.create(input({ channel: "sms", locale: "en", source: "sms-v1" }));

		const gallery = await repo.listGallery();
		expect(gallery).toHaveLength(2);
		for (const cell of gallery) {
			expect(cell.status).toBe("present-custom");
			expect(cell.updatedAt).toBeInstanceOf(Date);
		}
		const emailCell = gallery.find((c) => c.channel === "email");
		expect(emailCell?.eventKey).toBe("user.welcome");
	});

	it("listGallery is empty when no overrides exist", async () => {
		expect(await repo.listGallery()).toHaveLength(0);
	});
});
