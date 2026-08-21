/**
 * Unit tests for ListService — the thin CRUD facade over ListRepository.
 * Verifies each method delegates to the repository with the right arguments
 * and forwards the result, using a fully mocked repository.
 */

import { describe, expect, it, vi } from "vitest";
import { ListService } from "../src/lists/index";
import type { ListRepository } from "../src/repositories/list-repository";
import type { ListRecord } from "../src/repositories/types";

function makeListRecord(overrides: Partial<ListRecord> = {}): ListRecord {
	return {
		id: "lst_001",
		name: "Newsletter",
		slug: "newsletter",
		optinType: "single",
		visibility: "private",
		memberCount: 0,
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function makeRepo() {
	const repo: ListRepository = {
		create: vi.fn(),
		findById: vi.fn(),
		findBySlug: vi.fn(),
		list: vi.fn(),
		update: vi.fn(),
		archive: vi.fn(),
		updateMemberCount: vi.fn(),
	};
	return repo;
}

describe("ListService", () => {
	it("create delegates to the repository and returns the created record", async () => {
		const repo = makeRepo();
		const created = makeListRecord();
		(repo.create as ReturnType<typeof vi.fn>).mockResolvedValue(created);
		const service = new ListService({ listRepository: repo });

		const result = await service.create({ name: "Newsletter", slug: "newsletter" });

		expect(result).toBe(created);
		expect(repo.create).toHaveBeenCalledWith({ name: "Newsletter", slug: "newsletter" });
	});

	it("findById delegates to the repository", async () => {
		const repo = makeRepo();
		const record = makeListRecord();
		(repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(record);
		const service = new ListService({ listRepository: repo });

		const result = await service.findById("lst_001");

		expect(result).toBe(record);
		expect(repo.findById).toHaveBeenCalledWith("lst_001");
	});

	it("findById returns null when not found", async () => {
		const repo = makeRepo();
		(repo.findById as ReturnType<typeof vi.fn>).mockResolvedValue(null);
		const service = new ListService({ listRepository: repo });

		expect(await service.findById("missing")).toBeNull();
	});

	it("findBySlug delegates to the repository", async () => {
		const repo = makeRepo();
		const record = makeListRecord();
		(repo.findBySlug as ReturnType<typeof vi.fn>).mockResolvedValue(record);
		const service = new ListService({ listRepository: repo });

		const result = await service.findBySlug("newsletter");

		expect(result).toBe(record);
		expect(repo.findBySlug).toHaveBeenCalledWith("newsletter");
	});

	it("list forwards the filter and returns the cursor result", async () => {
		const repo = makeRepo();
		const page = { items: [makeListRecord()], cursor: undefined, hasMore: false };
		(repo.list as ReturnType<typeof vi.fn>).mockResolvedValue(page);
		const service = new ListService({ listRepository: repo });

		const result = await service.list({ archived: false, limit: 10 });

		expect(result).toBe(page);
		expect(repo.list).toHaveBeenCalledWith({ archived: false, limit: 10 });
	});

	it("list works with no filter argument", async () => {
		const repo = makeRepo();
		const page = { items: [], cursor: undefined, hasMore: false };
		(repo.list as ReturnType<typeof vi.fn>).mockResolvedValue(page);
		const service = new ListService({ listRepository: repo });

		const result = await service.list();

		expect(result).toBe(page);
		expect(repo.list).toHaveBeenCalledWith(undefined);
	});

	it("update delegates id and data to the repository", async () => {
		const repo = makeRepo();
		const updated = makeListRecord({ name: "Renamed" });
		(repo.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated);
		const service = new ListService({ listRepository: repo });

		const result = await service.update("lst_001", { name: "Renamed" });

		expect(result).toBe(updated);
		expect(repo.update).toHaveBeenCalledWith("lst_001", { name: "Renamed" });
	});

	it("archive delegates to the repository", async () => {
		const repo = makeRepo();
		const archived = makeListRecord({ archivedAt: new Date("2026-02-01T00:00:00Z") });
		(repo.archive as ReturnType<typeof vi.fn>).mockResolvedValue(archived);
		const service = new ListService({ listRepository: repo });

		const result = await service.archive("lst_001");

		expect(result).toBe(archived);
		expect(repo.archive).toHaveBeenCalledWith("lst_001");
	});
});
