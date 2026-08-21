import { describe, expect, it, vi } from "vitest";

const migrateMock = vi.fn().mockResolvedValue(undefined);
const endMock = vi.fn().mockResolvedValue(undefined);
const sqlClient = { end: endMock };
const postgresMock = vi.fn(() => sqlClient);
const drizzleMock = vi.fn(() => ({ $client: sqlClient }));

vi.mock("postgres", () => ({ default: postgresMock }));
vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: drizzleMock }));
vi.mock("drizzle-orm/postgres-js/migrator", () => ({ migrate: migrateMock }));

describe("runEmitoMigration", () => {
	it("uses a single-connection client pinned to search_path=public, migrates, then closes", async () => {
		const { runEmitoMigration } = await import("../steps/run-migration.js");
		await runEmitoMigration("postgres://x", "/some/drizzle/folder");

		// search_path must be forced on the connection itself (per-connection setting),
		// on a single-connection pool so migrate() shares that same connection.
		expect(postgresMock).toHaveBeenCalledWith("postgres://x", {
			max: 1,
			connection: { search_path: "public" },
		});
		expect(migrateMock).toHaveBeenCalledWith(expect.anything(), {
			migrationsFolder: "/some/drizzle/folder",
			migrationsSchema: "emito",
		});
		expect(endMock).toHaveBeenCalled();
	});

	it("still closes the connection when migration throws", async () => {
		migrateMock.mockRejectedValueOnce(new Error("boom"));
		const { runEmitoMigration } = await import("../steps/run-migration.js");

		await expect(runEmitoMigration("postgres://x", "/some/drizzle/folder")).rejects.toThrow("boom");
		expect(endMock).toHaveBeenCalled();
	});
});
