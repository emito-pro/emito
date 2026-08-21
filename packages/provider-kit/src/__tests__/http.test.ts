import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_TIMEOUT_MS, providerFetch, readErrorBody, resolveFetch } from "../http";

afterEach(() => {
	vi.unstubAllGlobals();
});

function okResponse(body = "ok"): Response {
	return { ok: true, status: 200, text: () => Promise.resolve(body) } as unknown as Response;
}

describe("resolveFetch", () => {
	it("returns the injected implementation when one is given", async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse());

		await resolveFetch(fetchFn)("https://example.test", {});

		expect(fetchFn).toHaveBeenCalled();
	});

	it("looks the global up lazily so a stub installed after import is honoured", async () => {
		const resolved = resolveFetch();
		const stub = vi.fn().mockResolvedValue(okResponse());
		vi.stubGlobal("fetch", stub);

		await resolved("https://example.test", {});

		expect(stub).toHaveBeenCalledWith("https://example.test", {});
	});
});

describe("providerFetch", () => {
	it("returns the response and forwards method, headers and body", async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse());

		const response = await providerFetch(
			"https://example.test",
			{ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
			{ displayName: "Example", fetchFn },
		);

		expect(response.ok).toBe(true);
		expect(fetchFn).toHaveBeenCalledWith(
			"https://example.test",
			expect.objectContaining({
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: "{}",
			}),
		);
	});

	it("attaches a timeout signal by default", async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse());

		await providerFetch("https://example.test", {}, { displayName: "Example", fetchFn });

		const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
		expect(init.signal).toBeInstanceOf(AbortSignal);
	});

	it("leaves a caller-supplied signal in place", async () => {
		const fetchFn = vi.fn().mockResolvedValue(okResponse());
		const controller = new AbortController();

		await providerFetch(
			"https://example.test",
			{ signal: controller.signal },
			{ displayName: "Example", fetchFn },
		);

		const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
		expect(init.signal).toBe(controller.signal);
	});

	it("maps an expired deadline to a retryable PROVIDER_TIMEOUT", async () => {
		const timeout = new Error("The operation was aborted due to timeout");
		timeout.name = "TimeoutError";
		const fetchFn = vi.fn().mockRejectedValue(timeout);

		try {
			await providerFetch(
				"https://example.test",
				{},
				{ displayName: "Example", fetchFn, timeoutMs: 25, context: { provider: "example" } },
			);
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_TIMEOUT);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).message).toContain("25ms");
			expect((err as EmitoError).context).toEqual({ provider: "example" });
		}
	});

	it("maps an AbortError the same way", async () => {
		const aborted = new Error("aborted");
		aborted.name = "AbortError";
		const fetchFn = vi.fn().mockRejectedValue(aborted);

		await expect(
			providerFetch("https://example.test", {}, { displayName: "Example", fetchFn }),
		).rejects.toMatchObject({ code: EMITO_ERROR_CODE.PROVIDER_TIMEOUT });
	});

	it("lets other failures propagate unclassified for the caller to handle", async () => {
		const networkError = new Error("fetch failed");
		const fetchFn = vi.fn().mockRejectedValue(networkError);

		await expect(
			providerFetch("https://example.test", {}, { displayName: "Example", fetchFn }),
		).rejects.toBe(networkError);
	});

	it("applies a ten second default deadline", () => {
		expect(DEFAULT_TIMEOUT_MS).toBe(10_000);
	});
});

describe("readErrorBody", () => {
	it("returns the response body", async () => {
		expect(await readErrorBody(okResponse("boom"))).toBe("boom");
	});

	it("returns a placeholder when the body cannot be read", async () => {
		const broken = {
			text: () => Promise.reject(new Error("stream consumed")),
		} as unknown as Response;

		expect(await readErrorBody(broken)).toBe("unknown");
	});
});
