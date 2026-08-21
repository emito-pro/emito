import { EMITO_ERROR_CODE, EmitoError, type EmitoErrorCode } from "@emito/types";

export async function requireOwnership(
	repo: { findById(id: string): Promise<{ ownerId: string } | null | undefined> },
	id: string,
	expectedOwnerId: string,
	notFoundCode: EmitoErrorCode = EMITO_ERROR_CODE.RESOURCE_NOT_FOUND,
): Promise<{ ownerId: string }> {
	const record = await repo.findById(id);

	if (!record) {
		throw new EmitoError({
			code: notFoundCode,
			message: `Resource not found: ${id}`,
		});
	}

	if (record.ownerId !== expectedOwnerId) {
		throw new EmitoError({
			code: EMITO_ERROR_CODE.AUTH_INSUFFICIENT_ROLE,
			message: "Not authorized to modify this resource",
		});
	}

	return record;
}
