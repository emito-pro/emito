import { EMITO_ERROR_CODE, EmitoError, RETRYABLE_RECORD } from "@emito/types";
import { describe, expect, it } from "vitest";
import {
	classifyHttpStatus,
	deliveryError,
	deliveryErrorContext,
	httpDeliveryError,
} from "../errors";
import { deliveryMetadata } from "../testing";

describe("deliveryErrorContext", () => {
	it("carries the four correlation fields and nothing else", () => {
		const context = deliveryErrorContext("twilio", "sms", deliveryMetadata());

		expect(context).toEqual({
			provider: "twilio",
			channel: "sms",
			notificationId: "notif-001",
			subscriberId: "sub-001",
		});
	});

	it("omits eventType, which is not needed to correlate a failure", () => {
		const context = deliveryErrorContext(
			"twilio",
			"sms",
			deliveryMetadata({ eventType: "order.shipped" }),
		);

		expect(Object.keys(context)).not.toContain("eventType");
	});
});

describe("deliveryError", () => {
	it("derives isRetryable from the canonical table rather than a caller flag", () => {
		expect(deliveryError(EMITO_ERROR_CODE.RATE_LIMITED, "slow down").isRetryable).toBe(
			RETRYABLE_RECORD.RATE_LIMITED,
		);
		expect(deliveryError(EMITO_ERROR_CODE.DELIVERY_REJECTED, "no").isRetryable).toBe(
			RETRYABLE_RECORD.DELIVERY_REJECTED,
		);
		expect(deliveryError(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE, "down").isRetryable).toBe(
			RETRYABLE_RECORD.PROVIDER_UNAVAILABLE,
		);
	});

	it("attaches context and cause", () => {
		const cause = new Error("underlying");
		const err = deliveryError(EMITO_ERROR_CODE.DELIVERY_REJECTED, "rejected", {
			context: { provider: "test" },
			cause,
		});

		expect(err).toBeInstanceOf(EmitoError);
		expect(err.context).toEqual({ provider: "test" });
		expect(err.cause).toBe(cause);
	});

	it("defaults context to an empty object", () => {
		expect(deliveryError(EMITO_ERROR_CODE.DELIVERY_REJECTED, "rejected").context).toEqual({});
	});
});

describe("classifyHttpStatus", () => {
	it("maps 429 to RATE_LIMITED", () => {
		expect(classifyHttpStatus(429)).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
	});

	it("maps 5xx to PROVIDER_UNAVAILABLE", () => {
		expect(classifyHttpStatus(500)).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
		expect(classifyHttpStatus(503)).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
	});

	it("maps other 4xx statuses to DELIVERY_REJECTED", () => {
		expect(classifyHttpStatus(400)).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
		expect(classifyHttpStatus(401)).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
		expect(classifyHttpStatus(403)).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
	});

	it("lets a provider override the meaning of a specific status", () => {
		const overrides = { 404: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS };

		expect(classifyHttpStatus(404, overrides)).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
		expect(classifyHttpStatus(404)).toBe(EMITO_ERROR_CODE.DELIVERY_REJECTED);
	});

	it("applies the default ladder for statuses an override map does not cover", () => {
		const overrides = { 404: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS };

		expect(classifyHttpStatus(429, overrides)).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
		expect(classifyHttpStatus(500, overrides)).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
	});
});

describe("httpDeliveryError", () => {
	it("classifies and phrases a rate-limit response", () => {
		const err = httpDeliveryError({ displayName: "Slack", status: 429, detail: "ratelimited" });

		expect(err.code).toBe(EMITO_ERROR_CODE.RATE_LIMITED);
		expect(err.isRetryable).toBe(true);
		expect(err.message).toBe("Slack rate limited (429): ratelimited");
	});

	it("classifies and phrases a server error", () => {
		const err = httpDeliveryError({ displayName: "Telegram", status: 503, detail: "unavailable" });

		expect(err.code).toBe(EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE);
		expect(err.message).toBe("Telegram server error (503): unavailable");
	});

	it("phrases an overridden destination failure", () => {
		const err = httpDeliveryError({
			displayName: "Slack",
			status: 404,
			detail: "channel_not_found",
			overrides: { 404: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS },
		});

		expect(err.code).toBe(EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS);
		expect(err.isRetryable).toBe(false);
		expect(err.message).toBe("Slack rejected the destination (404): channel_not_found");
	});

	it("omits the detail separator when no body was captured", () => {
		expect(httpDeliveryError({ displayName: "Slack", status: 400 }).message).toBe(
			"Slack delivery failed (400)",
		);
	});

	it("carries the supplied context", () => {
		const err = httpDeliveryError({
			displayName: "Slack",
			status: 400,
			context: { provider: "slack", channel: "slack" },
		});

		expect(err.context).toEqual({ provider: "slack", channel: "slack" });
	});
});
