import type { Channel } from "@emito/types";
import type { SuppressionRepository } from "../repositories/suppression-repository";
import type { CreateSuppressionData, SuppressionRecord } from "../repositories/types";

export interface SuppressionCheckParams {
	address: string;
	channel: Channel;
}

export interface SuppressionCheckResult {
	suppressed: boolean;
	record: SuppressionRecord | null;
}

export interface AddSuppressionParams extends CreateSuppressionData {}

export async function checkSuppression(
	repository: SuppressionRepository,
	params: SuppressionCheckParams,
): Promise<SuppressionCheckResult> {
	const record = await repository.findByAddressAndChannel(params.address, params.channel);

	if (record) {
		return { suppressed: true, record };
	}

	return { suppressed: false, record: null };
}

export async function addSuppression(
	repository: SuppressionRepository,
	params: AddSuppressionParams,
): Promise<SuppressionRecord> {
	return repository.create(params);
}
