import { describe, expect, it, vi } from "vitest";
import { verifyDelivery } from "../steps/verify-delivery.js";

describe("verifyDelivery", () => {
	it("returns true once the inbox shows the welcome.sent event", async () => {
		const listInbox = vi
			.fn()
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([{ event: "welcome.sent" }]);
		const send = vi.fn().mockResolvedValue({ ok: true });

		const result = await verifyDelivery({ send, listInbox });

		expect(result).toBe(true);
		expect(send).toHaveBeenCalledWith("welcome.sent", "cli-verify", expect.any(Object));
	});

	it("returns false when the inbox never shows the event", async () => {
		const listInbox = vi.fn().mockResolvedValue([]);
		const send = vi.fn().mockResolvedValue({ ok: true });

		const result = await verifyDelivery({ send, listInbox });

		expect(result).toBe(false);
	});
});
