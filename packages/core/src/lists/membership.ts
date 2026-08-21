import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import type { ListMemberRepository } from "../repositories/list-member-repository";
import type { ListRepository } from "../repositories/list-repository";
import type { CursorResult, ListMemberFilter, ListMemberRecord } from "../repositories/types";

export interface ConfirmEmailSender {
	sendConfirmationEmail(subscriberId: string, token: string, listName: string): Promise<void>;
}

export interface TokenSigner {
	sign(payload: Record<string, unknown>, secret: string): string;
}

export interface MembershipServiceDeps {
	listRepository: ListRepository;
	listMemberRepository: ListMemberRepository;
	confirmEmailSender?: ConfirmEmailSender;
	tokenSigner: TokenSigner;
	unsubscribeSecret: string;
}

const CONFIRM_TOKEN_EXPIRY_SECONDS = 259200; // 72 hours

export class MembershipService {
	private readonly listRepository: ListRepository;
	private readonly listMemberRepository: ListMemberRepository;
	private readonly confirmEmailSender?: ConfirmEmailSender;
	private readonly tokenSigner: TokenSigner;
	private readonly unsubscribeSecret: string;

	constructor(deps: MembershipServiceDeps) {
		this.listRepository = deps.listRepository;
		this.listMemberRepository = deps.listMemberRepository;
		this.confirmEmailSender = deps.confirmEmailSender;
		this.tokenSigner = deps.tokenSigner;
		this.unsubscribeSecret = deps.unsubscribeSecret;
	}

	async subscribe(
		subscriberId: string,
		listSlug: string,
		source?: string,
	): Promise<{ member: ListMemberRecord; created: boolean }> {
		const list = await this.listRepository.findBySlug(listSlug);
		if (!list) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${listSlug}" not found or archived`,
				isRetryable: false,
			});
		}

		const { member, created } = await this.listMemberRepository.subscribe({
			subscriberId,
			listId: list.id,
			source,
		});

		if (!created) {
			return { member, created: false };
		}

		if (list.optinType === "single") {
			const confirmed = await this.listMemberRepository.confirm(subscriberId, list.id);
			await this.listRepository.updateMemberCount(list.id, 1);
			return { member: confirmed, created: true };
		}

		// double opt-in: send confirmation email
		if (this.confirmEmailSender) {
			const now = Math.floor(Date.now() / 1000);
			const token = this.tokenSigner.sign(
				{
					sub: subscriberId,
					scope: "confirm",
					list: list.id,
					iat: now,
					exp: now + CONFIRM_TOKEN_EXPIRY_SECONDS,
				},
				this.unsubscribeSecret,
			);
			await this.confirmEmailSender.sendConfirmationEmail(subscriberId, token, list.name);
		}

		return { member, created: true };
	}

	async confirm(
		subscriberId: string,
		listId: string,
	): Promise<{ member: ListMemberRecord; alreadyConfirmed: boolean }> {
		const existing = await this.listMemberRepository.findBySubscriberAndList(subscriberId, listId);
		if (!existing) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: "List membership not found",
				isRetryable: false,
			});
		}

		if (existing.status === "confirmed") {
			return { member: existing, alreadyConfirmed: true };
		}

		const confirmed = await this.listMemberRepository.confirm(subscriberId, listId);
		await this.listRepository.updateMemberCount(listId, 1);
		return { member: confirmed, alreadyConfirmed: false };
	}

	async unsubscribe(subscriberId: string, listSlug: string): Promise<ListMemberRecord> {
		const list = await this.listRepository.findBySlug(listSlug);
		if (!list) {
			throw new EmitoError({
				code: EMITO_ERROR_CODE.VALIDATION_ERROR,
				message: `List "${listSlug}" not found or archived`,
				isRetryable: false,
			});
		}

		const existing = await this.listMemberRepository.findBySubscriberAndList(subscriberId, list.id);
		const wasConfirmed = existing?.status === "confirmed";

		const member = await this.listMemberRepository.unsubscribe(subscriberId, list.id);

		if (wasConfirmed) {
			await this.listRepository.updateMemberCount(list.id, -1);
		}

		return member;
	}

	async listSubscriptions(
		subscriberId: string,
		filter?: ListMemberFilter,
	): Promise<CursorResult<ListMemberRecord>> {
		return this.listMemberRepository.listBySubscriber(subscriberId, filter);
	}

	async cleanupExpired(): Promise<number> {
		const cutoff = new Date(Date.now() - CONFIRM_TOKEN_EXPIRY_SECONDS * 1000);
		return this.listMemberRepository.deleteExpiredUnconfirmed(cutoff);
	}
}
