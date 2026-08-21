import type { ListMemberRepository } from "../repositories/list-member-repository";
import type { ListRepository } from "../repositories/list-repository";

export interface ListMemberConfirm {
	confirmMembership(subscriberId: string, listId: string): Promise<{ alreadyConfirmed: boolean }>;
}

export class ListMemberConfirmAdapter implements ListMemberConfirm {
	constructor(
		private readonly listMemberRepository: ListMemberRepository,
		private readonly listRepository: ListRepository,
	) {}

	async confirmMembership(
		subscriberId: string,
		listId: string,
	): Promise<{ alreadyConfirmed: boolean }> {
		const existing = await this.listMemberRepository.findBySubscriberAndList(subscriberId, listId);

		if (!existing) {
			return { alreadyConfirmed: false };
		}

		if (existing.status === "confirmed") {
			return { alreadyConfirmed: true };
		}

		await this.listMemberRepository.confirm(subscriberId, listId);
		await this.listRepository.updateMemberCount(listId, 1);
		return { alreadyConfirmed: false };
	}
}
