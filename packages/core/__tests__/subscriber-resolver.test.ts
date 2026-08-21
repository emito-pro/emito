import { EMITO_ERROR_CODE, type EmitoError, type Subscriber } from "@emito/types";
import { beforeEach, describe, expect, it } from "vitest";
import { InMemorySubscriberRepository } from "../src/repositories/in-memory/in-memory-subscriber-repository";
import { resolveSubscriber } from "../src/subscribers/resolver";

function makeSubscriber(overrides: Partial<Subscriber> = {}): Subscriber {
	return {
		id: "sub_1",
		email: "original@example.com",
		phone: "+1234567890",
		pushTokens: ["token_1"],
		createdAt: new Date("2026-01-01"),
		updatedAt: new Date("2026-01-01"),
		...overrides,
	};
}

describe("Subscriber Resolver", () => {
	let subscriberRepo: InMemorySubscriberRepository;

	beforeEach(() => {
		subscriberRepo = new InMemorySubscriberRepository();
	});

	const deps = () => ({ subscriberRepository: subscriberRepo });

	describe("subscriber found, no overrides", () => {
		it("returns the subscriber from the repository", async () => {
			const subscriber = makeSubscriber();
			subscriberRepo.seed(subscriber);

			const result = await resolveSubscriber("sub_1", undefined, deps());

			expect(result.subscriber).toEqual(subscriber);
			expect(result.overridden).toBe(false);
		});

		it("preserves all subscriber fields", async () => {
			const subscriber = makeSubscriber({
				lang: "pl",
				timezone: "Europe/Warsaw",
				metadata: { plan: "pro" },
				globallyUnsubscribed: false,
			});
			subscriberRepo.seed(subscriber);

			const result = await resolveSubscriber("sub_1", undefined, deps());

			expect(result.subscriber.lang).toBe("pl");
			expect(result.subscriber.timezone).toBe("Europe/Warsaw");
			expect(result.subscriber.metadata).toEqual({ plan: "pro" });
		});
	});

	describe("subscriber found, with overrides", () => {
		it("merges email override", async () => {
			subscriberRepo.seed(makeSubscriber());

			const result = await resolveSubscriber("sub_1", { email: "override@example.com" }, deps());

			expect(result.subscriber.email).toBe("override@example.com");
			expect(result.subscriber.phone).toBe("+1234567890");
			expect(result.overridden).toBe(true);
		});

		it("merges phone override", async () => {
			subscriberRepo.seed(makeSubscriber());

			const result = await resolveSubscriber("sub_1", { phone: "+9876543210" }, deps());

			expect(result.subscriber.phone).toBe("+9876543210");
			expect(result.subscriber.email).toBe("original@example.com");
			expect(result.overridden).toBe(true);
		});

		it("merges pushTokens override", async () => {
			subscriberRepo.seed(makeSubscriber());

			const result = await resolveSubscriber("sub_1", { pushTokens: ["new_token"] }, deps());

			expect(result.subscriber.pushTokens).toEqual(["new_token"]);
			expect(result.overridden).toBe(true);
		});

		it("merges multiple overrides at once", async () => {
			subscriberRepo.seed(makeSubscriber());

			const result = await resolveSubscriber(
				"sub_1",
				{
					email: "new@example.com",
					phone: "+111",
					pushTokens: ["t1", "t2"],
				},
				deps(),
			);

			expect(result.subscriber.email).toBe("new@example.com");
			expect(result.subscriber.phone).toBe("+111");
			expect(result.subscriber.pushTokens).toEqual(["t1", "t2"]);
			expect(result.overridden).toBe(true);
		});

		it("does not override with undefined values", async () => {
			subscriberRepo.seed(makeSubscriber());

			const result = await resolveSubscriber("sub_1", { email: undefined }, deps());

			expect(result.subscriber.email).toBe("original@example.com");
			expect(result.overridden).toBe(true);
		});

		it("preserves non-overridable fields", async () => {
			const subscriber = makeSubscriber({
				globallyUnsubscribed: true,
				erasedAt: null,
				lang: "pl",
			});
			subscriberRepo.seed(subscriber);

			const result = await resolveSubscriber("sub_1", { email: "new@example.com" }, deps());

			expect(result.subscriber.globallyUnsubscribed).toBe(true);
			expect(result.subscriber.lang).toBe("pl");
			expect(result.subscriber.id).toBe("sub_1");
		});
	});

	describe("subscriber not found", () => {
		it("throws SUBSCRIBER_NOT_FOUND when no recipient provided", async () => {
			try {
				await resolveSubscriber("sub_unknown", undefined, deps());
				expect.fail("Should have thrown");
			} catch (err) {
				const error = err as EmitoError;
				expect(error.code).toBe(EMITO_ERROR_CODE.SUBSCRIBER_NOT_FOUND);
				expect(error.isRetryable).toBe(false);
				expect(error.context.subscriberId).toBe("sub_unknown");
			}
		});

		it("creates minimal subscriber from recipient when not found", async () => {
			const result = await resolveSubscriber(
				"sub_new",
				{ email: "new@example.com", phone: "+555" },
				deps(),
			);

			expect(result.subscriber.id).toBe("sub_new");
			expect(result.subscriber.email).toBe("new@example.com");
			expect(result.subscriber.phone).toBe("+555");
			expect(result.subscriber.createdAt).toBeInstanceOf(Date);
			expect(result.subscriber.updatedAt).toBeInstanceOf(Date);
			expect(result.overridden).toBe(true);
		});

		it("creates minimal subscriber with only email", async () => {
			const result = await resolveSubscriber("sub_new", { email: "only@example.com" }, deps());

			expect(result.subscriber.email).toBe("only@example.com");
			expect(result.subscriber.phone).toBeUndefined();
			expect(result.subscriber.pushTokens).toBeUndefined();
		});

		it("creates minimal subscriber with only pushTokens", async () => {
			const result = await resolveSubscriber("sub_new", { pushTokens: ["token_a"] }, deps());

			expect(result.subscriber.pushTokens).toEqual(["token_a"]);
			expect(result.subscriber.email).toBeUndefined();
		});
	});
});
