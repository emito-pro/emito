import { EmitoError } from "@emito/types";
import type {
	DeliveryMetadata,
	EmailDeliveryParams,
	EmitoErrorCode,
	PushDeliveryParams,
	SlackDeliveryParams,
	SmsDeliveryParams,
	TelegramDeliveryParams,
} from "@emito/types";

/**
 * Fixtures and assertions for provider test suites.
 *
 * Framework-agnostic on purpose — this module imports no test runner, so it
 * costs a provider nothing to depend on and works under vitest, node:test or
 * anything else.
 */

export function deliveryMetadata(overrides?: Partial<DeliveryMetadata>): DeliveryMetadata {
	return {
		notificationId: "notif-001",
		subscriberId: "sub-001",
		eventType: "test.event",
		...overrides,
	};
}

export function emailParams(overrides?: Partial<EmailDeliveryParams>): EmailDeliveryParams {
	return {
		channel: "email",
		to: "user@example.com",
		subject: "Test Subject",
		html: "<p>Hello</p>",
		text: "Hello",
		metadata: deliveryMetadata(),
		...overrides,
	};
}

export function smsParams(overrides?: Partial<SmsDeliveryParams>): SmsDeliveryParams {
	return {
		channel: "sms",
		to: "+48123456789",
		body: "Hello",
		metadata: deliveryMetadata(),
		...overrides,
	};
}

export function pushParams(overrides?: Partial<PushDeliveryParams>): PushDeliveryParams {
	return {
		channel: "push",
		tokens: ["token-001"],
		title: "Test Title",
		body: "Hello",
		metadata: deliveryMetadata(),
		...overrides,
	};
}

export function slackParams(overrides?: Partial<SlackDeliveryParams>): SlackDeliveryParams {
	return {
		channel: "slack",
		webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
		blocks: [{ type: "section", text: { type: "mrkdwn", text: "Hello" } }],
		text: "Hello fallback",
		metadata: deliveryMetadata(),
		...overrides,
	};
}

export function telegramParams(
	overrides?: Partial<TelegramDeliveryParams>,
): TelegramDeliveryParams {
	return {
		channel: "telegram",
		botToken: "bot-token-001",
		chatId: "chat-001",
		html: "<b>Hello</b>",
		metadata: deliveryMetadata(),
		...overrides,
	};
}

export interface ExpectedEmitoError {
	code: EmitoErrorCode;
	isRetryable?: boolean;
	/** Keys and values the context must contain; extra keys are allowed. */
	context?: Record<string, unknown>;
}

/**
 * Asserts that a caught value is an `EmitoError` with the expected
 * classification, and returns it narrowed for further inspection.
 */
export function assertEmitoError(err: unknown, expected: ExpectedEmitoError): EmitoError {
	if (!(err instanceof EmitoError)) {
		throw new Error(`Expected an EmitoError, received: ${String(err)}`);
	}
	if (err.code !== expected.code) {
		throw new Error(`Expected error code ${expected.code}, received ${err.code}`);
	}
	if (expected.isRetryable !== undefined && err.isRetryable !== expected.isRetryable) {
		throw new Error(
			`Expected isRetryable ${expected.isRetryable} for ${err.code}, received ${err.isRetryable}`,
		);
	}
	for (const [key, value] of Object.entries(expected.context ?? {})) {
		if (JSON.stringify(err.context[key]) !== JSON.stringify(value)) {
			throw new Error(
				`Expected context.${key} to be ${JSON.stringify(value)}, received ${JSON.stringify(err.context[key])}`,
			);
		}
	}
	return err;
}

/**
 * Asserts that no given substring leaked into an error's context.
 *
 * Provider error contexts are logged and persisted on dead-letter records, so
 * credentials, recipient addresses and payload bodies must stay out of them.
 */
export function assertContextOmits(err: unknown, forbidden: readonly string[]): void {
	if (!(err instanceof EmitoError)) {
		throw new Error(`Expected an EmitoError, received: ${String(err)}`);
	}
	const serialized = JSON.stringify(err.context);
	for (const value of forbidden) {
		if (serialized.includes(value)) {
			throw new Error(`Error context leaked ${JSON.stringify(value)}: ${serialized}`);
		}
	}
}
