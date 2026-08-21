import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { EmailDeliveryParams } from "@emito/types";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineProvider } from "../define-provider";
import { deliveryError } from "../errors";
import { emailParams } from "../testing";

const ConfigSchema = z.object({
	apiKey: z.string().min(1, "apiKey is required"),
	from: z.string().min(1, "from is required"),
});

type Config = z.infer<typeof ConfigSchema>;

function createTestProvider(
	overrides?: Partial<Parameters<typeof defineProvider<"email", Config, Config>>[0]>,
) {
	return defineProvider<"email", Config, Config>({
		name: "test",
		displayName: "Test",
		channel: "email",
		configSchema: ConfigSchema,
		setup: (config) => config,
		deliver: async () => ({ success: true, providerMessageId: "msg-1" }),
		...overrides,
	});
}

const validConfig: Config = { apiKey: "key_123", from: "noreply@example.com" };

describe("defineProvider — plugin shape", () => {
	it("returns a ProviderPlugin carrying the declared name and channel", () => {
		const provider = createTestProvider()(validConfig);

		expect(provider.name).toBe("test");
		expect(provider.channel).toBe("email");
	});

	it("defaults healthCheck to reporting healthy", async () => {
		const provider = createTestProvider()(validConfig);

		expect(await provider.healthCheck()).toBe(true);
	});

	it("uses a supplied healthCheck and hands it the setup context", async () => {
		const healthCheck = vi.fn().mockReturnValue(false);
		const provider = createTestProvider({ healthCheck })(validConfig);

		expect(await provider.healthCheck()).toBe(false);
		expect(healthCheck).toHaveBeenCalledWith(validConfig);
	});

	it("runs setup once at construction, not per delivery", async () => {
		const setup = vi.fn((config: Config) => config);
		const provider = createTestProvider({ setup })(validConfig);

		await provider.deliver(emailParams());
		await provider.deliver(emailParams());

		expect(setup).toHaveBeenCalledTimes(1);
	});
});

describe("defineProvider — config validation", () => {
	it("throws CONFIG_INVALID naming the provider when the schema rejects the config", () => {
		try {
			createTestProvider()({ apiKey: "", from: "noreply@example.com" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.CONFIG_INVALID);
			expect((err as EmitoError).isRetryable).toBe(false);
			expect((err as EmitoError).message).toContain("Invalid Test provider config");
			expect((err as EmitoError).context).toMatchObject({ provider: "test" });
		}
	});

	it("does not leak credential values into the CONFIG_INVALID context", () => {
		try {
			createTestProvider()({ apiKey: "key_super_secret", from: "" });
			expect.fail("should have thrown");
		} catch (err) {
			expect(JSON.stringify((err as EmitoError).context)).not.toContain("key_super_secret");
		}
	});

	it("skips validation and passes the config straight through when no schema is declared", () => {
		const setup = vi.fn((config: { fetchFn?: unknown }) => config);
		const factory = defineProvider<"email", { fetchFn?: unknown }, { fetchFn?: unknown }>({
			name: "schemaless",
			channel: "email",
			setup,
			deliver: async () => ({ success: true }),
		});

		factory({});

		expect(setup).toHaveBeenCalledWith({});
	});

	it("does not run setup when config validation fails", () => {
		const setup = vi.fn((config: Config) => config);

		expect(() => createTestProvider({ setup })({ apiKey: "", from: "" })).toThrow(EmitoError);
		expect(setup).not.toHaveBeenCalled();
	});
});

describe("defineProvider — delivery", () => {
	it("narrows the channel params before handing them to deliver", async () => {
		let received: EmailDeliveryParams | undefined;
		const provider = createTestProvider({
			deliver: async (params) => {
				// Typed as EmailDeliveryParams here — no cast at the call site.
				received = params;
				return { success: true };
			},
		})(validConfig);

		await provider.deliver(emailParams({ subject: "Narrowed" }));

		expect(received?.subject).toBe("Narrowed");
	});

	it("returns the DeliveryResult produced by deliver untouched", async () => {
		const provider = createTestProvider()(validConfig);

		expect(await provider.deliver(emailParams())).toEqual({
			success: true,
			providerMessageId: "msg-1",
		});
	});

	it("builds an error context of exactly the four correlation fields", async () => {
		const provider = createTestProvider({
			deliver: async (_params, _ctx, errorContext) => {
				throw deliveryError(EMITO_ERROR_CODE.DELIVERY_REJECTED, "nope", {
					context: errorContext,
				});
			},
		})(validConfig);

		try {
			await provider.deliver(emailParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).context).toEqual({
				provider: "test",
				channel: "email",
				notificationId: "notif-001",
				subscriberId: "sub-001",
			});
		}
	});
});

describe("defineProvider — error handling", () => {
	it("wraps an unclassified thrown error as retryable PROVIDER_UNAVAILABLE", async () => {
		const provider = createTestProvider({
			deliver: async () => {
				throw new Error("socket hang up");
			},
		})(validConfig);

		try {
			await provider.deliver(emailParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(EmitoError);
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
			expect((err as EmitoError).isRetryable).toBe(true);
			expect((err as EmitoError).cause).toBeInstanceOf(Error);
			expect((err as EmitoError).context).toMatchObject({ provider: "test" });
		}
	});

	it("wraps thrown non-Error values", async () => {
		const provider = createTestProvider({
			deliver: async () => {
				throw "string failure";
			},
		})(validConfig);

		await expect(provider.deliver(emailParams())).rejects.toBeInstanceOf(EmitoError);
	});

	it("re-throws an EmitoError from deliver without double-wrapping it", async () => {
		const original = deliveryError(EMITO_ERROR_CODE.RATE_LIMITED, "already classified");
		const provider = createTestProvider({
			deliver: async () => {
				throw original;
			},
		})(validConfig);

		await expect(provider.deliver(emailParams())).rejects.toBe(original);
	});

	it("does not consult mapError for an already-classified EmitoError", async () => {
		const mapError = vi.fn();
		const provider = createTestProvider({
			mapError,
			deliver: async () => {
				throw deliveryError(EMITO_ERROR_CODE.RATE_LIMITED, "classified");
			},
		})(validConfig);

		await expect(provider.deliver(emailParams())).rejects.toBeInstanceOf(EmitoError);
		expect(mapError).not.toHaveBeenCalled();
	});

	it("uses the classification returned by mapError", async () => {
		const provider = createTestProvider({
			mapError: (err, errorContext) =>
				deliveryError(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS, `mapped: ${String(err)}`, {
					context: { ...errorContext, sdkCode: 21211 },
				}),
			deliver: async () => {
				throw new Error("sdk blew up");
			},
		})(validConfig);

		try {
			await provider.deliver(emailParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
			expect((err as EmitoError).context).toMatchObject({ sdkCode: 21211 });
		}
	});

	it("falls back to PROVIDER_UNAVAILABLE when mapError declines to classify", async () => {
		const provider = createTestProvider({
			mapError: () => undefined,
			deliver: async () => {
				throw new Error("unrecognised");
			},
		})(validConfig);

		try {
			await provider.deliver(emailParams());
			expect.fail("should have thrown");
		} catch (err) {
			expect((err as EmitoError).code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
		}
	});
});
