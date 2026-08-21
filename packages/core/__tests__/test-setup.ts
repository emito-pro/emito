import { afterEach, inject, vi } from "vitest";

export const dbUri = inject("DB_URI");

afterEach(() => {
	vi.restoreAllMocks();
});
