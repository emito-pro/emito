import type { ConsentFilter, ConsentRecord, CreateConsentData, CursorResult } from "./types";

export interface ConsentRepository {
	recordConsent(data: CreateConsentData): Promise<ConsentRecord>;
	getLatestConsent(subscriberId: string, category: string): Promise<ConsentRecord | null>;
	listConsentHistory(
		subscriberId: string,
		filter?: ConsentFilter,
	): Promise<CursorResult<ConsentRecord>>;
	listAll(filter?: ConsentFilter): Promise<CursorResult<ConsentRecord>>;
}
