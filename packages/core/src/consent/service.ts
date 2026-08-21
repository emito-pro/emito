import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ConsentRepository } from "../repositories/consent-repository";
import type {
	ConsentFilter,
	ConsentRecord,
	CreateConsentData,
	CursorResult,
} from "../repositories/types";

export interface ConsentServiceDeps {
	consentRepository: ConsentRepository;
}

export interface ConsentService {
	recordConsent(data: CreateConsentData): Promise<ConsentRecord>;
	getLatestConsent(subscriberId: string, category: string): Promise<ConsentRecord | null>;
	listHistory(subscriberId: string, filter?: ConsentFilter): Promise<CursorResult<ConsentRecord>>;
	listAll(filter?: ConsentFilter): Promise<CursorResult<ConsentRecord>>;
}

export function createConsentService(deps: ConsentServiceDeps): ConsentService {
	const { consentRepository } = deps;

	return {
		async recordConsent(data: CreateConsentData): Promise<ConsentRecord> {
			if (!data.subscriberId) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.VALIDATION_ERROR,
					message: "subscriberId is required",
					isRetryable: false,
				});
			}

			if (!data.category) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.VALIDATION_ERROR,
					message: "category is required",
					isRetryable: false,
				});
			}

			return consentRepository.recordConsent(data);
		},

		async getLatestConsent(subscriberId: string, category: string): Promise<ConsentRecord | null> {
			return consentRepository.getLatestConsent(subscriberId, category);
		},

		async listHistory(
			subscriberId: string,
			filter?: ConsentFilter,
		): Promise<CursorResult<ConsentRecord>> {
			return consentRepository.listConsentHistory(subscriberId, filter);
		},

		async listAll(filter?: ConsentFilter): Promise<CursorResult<ConsentRecord>> {
			return consentRepository.listAll(filter);
		},
	};
}
