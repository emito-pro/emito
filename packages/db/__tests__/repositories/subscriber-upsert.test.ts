import { describe, expect, it } from "vitest";
import { DrizzleSubscriberRepository } from "../../src/repositories/drizzle-subscriber-repository";
import { dbAvailable, getDb, setupAdminTestDb } from "./admin-test-db";

setupAdminTestDb();

describe("DrizzleSubscriberRepository.upsert", () => {
	it("inserts when absent and updates on conflict", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSubscriberRepository(getDb());
		const created = await repo.upsert({
			id: "user_1",
			email: "a@x.pl",
			lang: "pl",
			metadata: { source: "signup" },
		});
		expect(created.email).toBe("a@x.pl");
		expect(created.lang).toBe("pl");
		expect(created.metadata).toEqual({ source: "signup" });

		const updated = await repo.upsert({ id: "user_1", email: "b@x.pl", lang: "pl" });
		expect(updated.email).toBe("b@x.pl");
		const found = await repo.findById("user_1");
		expect(found?.email).toBe("b@x.pl");

		// Upserting again without lang/metadata must preserve the previously stored values,
		// not overwrite them with defaults (F2 regression: `lang: data.lang ?? 'en'` and a
		// missing `metadata` field on the update path used to clobber existing data).
		const preserved = await repo.upsert({ id: "user_1", email: "c@x.pl" });
		expect(preserved.email).toBe("c@x.pl");
		expect(preserved.lang).toBe("pl");
		expect(preserved.metadata).toEqual({ source: "signup" });
	});

	it("preserves existing email when upsert omits it", async () => {
		if (!dbAvailable()) return;
		const repo = new DrizzleSubscriberRepository(getDb());
		await repo.upsert({ id: "user_email_preserve", email: "keep@x.pl", lang: "en" });

		const updated = await repo.upsert({ id: "user_email_preserve", lang: "pl" });
		expect(updated.lang).toBe("pl");
		expect(updated.email).toBe("keep@x.pl");
	});
});
