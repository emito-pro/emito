import type { DeliveryStatus } from "@emito/types";

export interface WebhookEvent {
	providerMsgId: string;
	status: DeliveryStatus;
	metadata?: Record<string, unknown>;
}

export interface WebhookVerifier {
	verify(rawBody: string, headers: Headers, secret: string): boolean;
	normalize(payload: unknown): WebhookEvent[];
}
