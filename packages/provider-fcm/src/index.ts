import { defineProvider, deliveryError } from "@emito/provider-kit";
import type { DeliveryErrorContext } from "@emito/provider-kit";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { EmitoErrorCode } from "@emito/types";
import { type App, cert, initializeApp } from "firebase-admin/app";
import { type Messaging, getMessaging } from "firebase-admin/messaging";
import { z } from "zod";

export const FcmProviderConfigSchema = z.object({
	projectId: z.string().min(1, "projectId is required"),
	clientEmail: z.string().min(1, "clientEmail is required"),
	privateKey: z.string().min(1, "privateKey is required"),
});

export type FcmProviderConfig = z.infer<typeof FcmProviderConfigSchema>;

const FCM_ERROR_MAP: Readonly<Record<string, { code: EmitoErrorCode; label: string }>> = {
	"messaging/registration-token-not-registered": {
		code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
		label: "invalid token",
	},
	"messaging/invalid-registration-token": {
		code: EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
		label: "invalid token",
	},
	"messaging/too-many-requests": { code: EMITO_ERROR_CODE.RATE_LIMITED, label: "rate limited" },
	"messaging/message-rate-exceeded": {
		code: EMITO_ERROR_CODE.RATE_LIMITED,
		label: "rate limited",
	},
	"messaging/topics-message-rate-exceeded": {
		code: EMITO_ERROR_CODE.RATE_LIMITED,
		label: "rate limited",
	},
	"messaging/server-unavailable": {
		code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
		label: "unavailable",
	},
	"messaging/internal-error": {
		code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
		label: "unavailable",
	},
	"messaging/unknown-error": {
		code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
		label: "unavailable",
	},
	"messaging/invalid-argument": {
		code: EMITO_ERROR_CODE.DELIVERY_REJECTED,
		label: "delivery rejected",
	},
	"messaging/mismatched-credential": {
		code: EMITO_ERROR_CODE.DELIVERY_REJECTED,
		label: "delivery rejected",
	},
};

interface FcmContext {
	messaging: Messaging;
}

export const createFcmProvider = defineProvider<"push", FcmProviderConfig, FcmContext>({
	name: "fcm",
	displayName: "FCM",
	channel: "push",
	configSchema: FcmProviderConfigSchema,

	setup: ({ projectId, clientEmail, privateKey }) => {
		const app: App = initializeApp(
			{
				credential: cert({ projectId, clientEmail, privateKey }),
			},
			`emito-fcm-${Date.now()}`,
		);

		return { messaging: getMessaging(app) };
	},

	deliver: async (params, { messaging }, errorContext) => {
		if (params.tokens.length === 0) {
			return { success: true };
		}

		const results = await Promise.allSettled(
			params.tokens.map((token) =>
				messaging.send({
					token,
					notification: {
						title: params.title,
						body: params.body,
					},
					data: params.data,
				}),
			),
		);

		let successCount = 0;
		const invalidTokens: string[] = [];
		let lastError: EmitoError | undefined;

		for (let i = 0; i < results.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: bounds guaranteed by loop condition
			const entry = results[i]!;
			if (entry.status === "fulfilled") {
				successCount++;
			} else {
				const mapped = mapFcmError(entry.reason, errorContext);
				if (mapped.code === EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS) {
					// biome-ignore lint/style/noNonNullAssertion: index corresponds to results array, same bounds
					invalidTokens.push(params.tokens[i]!);
				} else {
					lastError = mapped;
				}
			}
		}

		if (successCount > 0) {
			return {
				success: true,
				providerMessageId: `${successCount}/${params.tokens.length}`,
				invalidTokens: invalidTokens.length > 0 ? invalidTokens : undefined,
			};
		}

		if (invalidTokens.length > 0) {
			throw deliveryError(
				EMITO_ERROR_CODE.DELIVERY_INVALID_ADDRESS,
				`FCM delivery failed: all ${invalidTokens.length} token(s) invalid`,
				{ context: errorContext },
			);
		}

		if (lastError) {
			throw lastError;
		}

		throw deliveryError(
			EMITO_ERROR_CODE.DELIVERY_REJECTED,
			"FCM delivery failed: no tokens succeeded",
			{
				context: errorContext,
			},
		);
	},
});

interface FcmError {
	code: string;
	message: string;
}

function isFcmError(err: unknown): err is FcmError {
	if (!(err instanceof Error)) return false;
	const record = err as unknown as Record<string, unknown>;
	return typeof record.code === "string";
}

/**
 * Classifies a single token's failure. Returns rather than throws: the caller
 * inspects the code to decide whether the token goes on the invalid list or
 * becomes the error representing the whole batch.
 */
function mapFcmError(err: unknown, context: DeliveryErrorContext): EmitoError {
	if (err instanceof EmitoError) {
		return err;
	}

	if (!isFcmError(err)) {
		return EmitoError.fromUnknown(err, {
			code: EMITO_ERROR_CODE.PROVIDER_UNAVAILABLE,
			context,
		});
	}

	const errorContext = { ...context, fcmErrorCode: err.code };
	const mapped = FCM_ERROR_MAP[err.code];

	if (mapped) {
		return deliveryError(mapped.code, `FCM ${mapped.label}: ${err.message}`, {
			context: errorContext,
		});
	}

	return deliveryError(EMITO_ERROR_CODE.DELIVERY_REJECTED, `FCM delivery failed: ${err.message}`, {
		context: errorContext,
	});
}
