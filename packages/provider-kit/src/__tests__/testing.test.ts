import { EMITO_ERROR_CODE } from "@emito/types";
import { describe, expect, it } from "vitest";
import { deliveryError } from "../errors";
import {
	assertContextOmits,
	assertEmitoError,
	deliveryMetadata,
	emailParams,
	pushParams,
	slackParams,
	smsParams,
	telegramParams,
} from "../testing";

describe("fixtures", () => {
	it("build params tagged with the matching channel", () => {
		expect(emailParams().channel).toBe("email");
		expect(smsParams().channel).toBe("sms");
		expect(pushParams().channel).toBe("push");
		expect(slackParams().channel).toBe("slack");
		expect(telegramParams().channel).toBe("telegram");
	});

	it("share a default metadata block", () => {
		expect(emailParams().metadata).toEqual(deliveryMetadata());
		expect(smsParams().metadata).toEqual(deliveryMetadata());
	});

	it("accept overrides", () => {
		expect(emailParams({ to: "other@example.com" }).to).toBe("other@example.com");
		expect(deliveryMetadata({ notificationId: "notif-999" }).notificationId).toBe("notif-999");
	});
});

describe("assertEmitoError", () => {
	const err = deliveryError(EMITO_ERROR_CODE.RATE_LIMITED, "slow down", {
		context: { provider: "test", attempt: 2 },
	});

	it("returns the narrowed error when expectations hold", () => {
		expect(
			assertEmitoError(err, {
				code: EMITO_ERROR_CODE.RATE_LIMITED,
				isRetryable: true,
				context: { provider: "test" },
			}),
		).toBe(err);
	});

	it("rejects a value that is not an EmitoError", () => {
		expect(() =>
			assertEmitoError(new Error("plain"), { code: EMITO_ERROR_CODE.RATE_LIMITED }),
		).toThrow(/Expected an EmitoError/);
	});

	it("rejects a mismatched code", () => {
		expect(() => assertEmitoError(err, { code: EMITO_ERROR_CODE.DELIVERY_REJECTED })).toThrow(
			/Expected error code DELIVERY_REJECTED/,
		);
	});

	it("rejects a mismatched retryability", () => {
		expect(() =>
			assertEmitoError(err, { code: EMITO_ERROR_CODE.RATE_LIMITED, isRetryable: false }),
		).toThrow(/Expected isRetryable false/);
	});

	it("rejects a mismatched context value", () => {
		expect(() =>
			assertEmitoError(err, {
				code: EMITO_ERROR_CODE.RATE_LIMITED,
				context: { provider: "other" },
			}),
		).toThrow(/Expected context.provider/);
	});
});

describe("assertContextOmits", () => {
	const err = deliveryError(EMITO_ERROR_CODE.DELIVERY_REJECTED, "rejected", {
		context: { provider: "test", notificationId: "notif-001" },
	});

	it("passes when none of the forbidden values appear", () => {
		expect(() => assertContextOmits(err, ["sk_live_123", "user@example.com"])).not.toThrow();
	});

	it("fails when a forbidden value leaked into the context", () => {
		expect(() => assertContextOmits(err, ["notif-001"])).toThrow(/leaked/);
	});

	it("rejects a value that is not an EmitoError", () => {
		expect(() => assertContextOmits("nope", ["x"])).toThrow(/Expected an EmitoError/);
	});
});
