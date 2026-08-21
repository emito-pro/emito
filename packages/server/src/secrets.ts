import type { IntegrationRecord } from "@emito/core";
import type { Channel } from "@emito/types";

export const DEFAULT_SECRET_FIELDS: Partial<Record<Channel, string[]>> = {
	slack: ["botToken", "signingSecret", "webhookUrl"],
	telegram: ["botToken"],
	discord: ["botToken", "webhookUrl"],
	email: ["apiKey"],
	sms: ["apiKey", "authToken"],
	webhook: ["signingSecret"],
	whatsapp: ["apiKey", "authToken"],
};

export function getEffectiveSecretFields(
	channel: Channel,
	recordSecretFields?: string[],
): string[] {
	const defaults = DEFAULT_SECRET_FIELDS[channel] ?? [];
	if (!recordSecretFields || recordSecretFields.length === 0) return defaults;
	return [...new Set([...defaults, ...recordSecretFields])];
}

export function maskSecrets(record: IntegrationRecord): IntegrationRecord {
	const fields = getEffectiveSecretFields(record.channel, record.secretFields);
	if (fields.length === 0) return record;

	const maskedConfig: Record<string, unknown> = { ...record.config };
	for (const field of fields) {
		if (field in maskedConfig && typeof maskedConfig[field] === "string") {
			const value = maskedConfig[field] as string;
			if (value.length <= 4) {
				maskedConfig[field] = "****";
			} else {
				maskedConfig[field] = `***${value.slice(-4)}`;
			}
		}
	}

	return { ...record, config: maskedConfig };
}

export function stripConfig(record: IntegrationRecord): Omit<IntegrationRecord, "config"> {
	const { config: _, ...rest } = record;
	return rest;
}
