import type {
	TemplateGalleryCell,
	TemplateOverrideCreate,
	TemplateOverrideRecord,
} from "../admin-types";
import type { TemplateOverrideRepository } from "../template-override-repository";
import { nextId } from "./admin-ids";

/**
 * In-memory {@link TemplateOverrideRepository} for unit tests.
 *
 * Overrides are append-only versions: `create` auto-bumps `version` to `max(existing)+1` per
 * (event, channel, locale). `findActive` returns the highest-version row for a triple.
 * `listGallery` returns one `present-custom` cell per distinct triple that has any override.
 */
export class InMemoryTemplateOverrideRepository implements TemplateOverrideRepository {
	private readonly records = new Map<string, TemplateOverrideRecord>();

	async listGallery(): Promise<readonly TemplateGalleryCell[]> {
		const latestByTriple = new Map<string, TemplateOverrideRecord>();
		for (const record of this.records.values()) {
			const key = this.tripleKey(record.eventKey, record.channel, record.locale);
			const current = latestByTriple.get(key);
			if (!current || record.version > current.version) {
				latestByTriple.set(key, record);
			}
		}

		return [...latestByTriple.values()]
			.sort(
				(a, b) =>
					a.eventKey.localeCompare(b.eventKey) ||
					a.channel.localeCompare(b.channel) ||
					a.locale.localeCompare(b.locale),
			)
			.map((r) => ({
				eventKey: r.eventKey,
				channel: r.channel,
				locale: r.locale,
				status: "present-custom" as const,
				updatedAt: r.updatedAt,
			}));
	}

	async findActive(
		eventKey: string,
		channel: string,
		locale: string,
	): Promise<TemplateOverrideRecord | null> {
		const matches = [...this.records.values()].filter(
			(r) => r.eventKey === eventKey && r.channel === channel && r.locale === locale,
		);
		if (matches.length === 0) return null;
		return matches.reduce((best, r) => (r.version > best.version ? r : best));
	}

	async create(input: TemplateOverrideCreate): Promise<TemplateOverrideRecord> {
		const existing = await this.findActive(input.eventKey, input.channel, input.locale);
		const version = (existing?.version ?? 0) + 1;
		const now = new Date();
		const record: TemplateOverrideRecord = {
			id: nextId("tmo"),
			eventKey: input.eventKey,
			channel: input.channel,
			locale: input.locale,
			source: input.source,
			compiledWarning: input.compiledWarning ?? null,
			version,
			createdByUserId: input.createdByUserId,
			updatedByUserId: input.updatedByUserId,
			createdAt: now,
			updatedAt: now,
		};
		this.records.set(record.id, record);
		return record;
	}

	async history(
		eventKey: string,
		channel: string,
		locale: string,
		limit: number,
	): Promise<readonly TemplateOverrideRecord[]> {
		return [...this.records.values()]
			.filter((r) => r.eventKey === eventKey && r.channel === channel && r.locale === locale)
			.sort((a, b) => b.version - a.version)
			.slice(0, Math.max(0, limit));
	}

	private tripleKey(eventKey: string, channel: string, locale: string): string {
		return `${eventKey}::${channel}::${locale}`;
	}

	/** Test helper: drop all records. */
	clear(): void {
		this.records.clear();
	}
}
