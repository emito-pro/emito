import type {
	TemplateGalleryCell,
	TemplateOverrideChannel,
	TemplateOverrideCreate,
	TemplateOverrideRecord,
	TemplateOverrideRepository,
} from "@emito/core";
import { EMITO_ERROR_CODE, EmitoError } from "@emito/types";
import { and, desc, eq, sql } from "drizzle-orm";
import { emito_template_overrides } from "../schema/template-overrides";
import type { DrizzleDb } from "./db-type";

/**
 * Drizzle implementation of {@link TemplateOverrideRepository}.
 *
 * Overrides are append-only versions. `create` computes the next version as `max(version)+1`
 * for the (event, channel, locale) triple inside a serializable-safe transaction so two
 * concurrent edits cannot mint the same version (the unique index is the hard backstop —
 * a 23505 race is re-mapped to `RESOURCE_CONFLICT`). `findActive` resolves the highest
 * version. `listGallery` returns one `present-custom` cell per distinct triple.
 */
export class DrizzleTemplateOverrideRepository implements TemplateOverrideRepository {
	constructor(private readonly db: DrizzleDb) {}

	async listGallery(): Promise<readonly TemplateGalleryCell[]> {
		// DISTINCT ON the triple, ordered so the row kept is the highest version.
		const rows = await this.db
			.selectDistinctOn(
				[
					emito_template_overrides.eventKey,
					emito_template_overrides.channel,
					emito_template_overrides.locale,
				],
				{
					eventKey: emito_template_overrides.eventKey,
					channel: emito_template_overrides.channel,
					locale: emito_template_overrides.locale,
					updatedAt: emito_template_overrides.updatedAt,
				},
			)
			.from(emito_template_overrides)
			.orderBy(
				emito_template_overrides.eventKey,
				emito_template_overrides.channel,
				emito_template_overrides.locale,
				desc(emito_template_overrides.version),
			);

		return rows.map((r) => ({
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
		const [row] = await this.db
			.select()
			.from(emito_template_overrides)
			.where(this.tripleWhere(eventKey, channel, locale))
			.orderBy(desc(emito_template_overrides.version))
			.limit(1);
		return row ? this.mapRow(row) : null;
	}

	async create(input: TemplateOverrideCreate): Promise<TemplateOverrideRecord> {
		try {
			return await this.db.transaction(async (tx) => {
				const [maxRow] = await tx
					.select({ max: sql<number | null>`max(${emito_template_overrides.version})` })
					.from(emito_template_overrides)
					.where(this.tripleWhere(input.eventKey, input.channel, input.locale));
				const nextVersion = (maxRow?.max ?? 0) + 1;

				const [row] = await tx
					.insert(emito_template_overrides)
					.values({
						eventKey: input.eventKey,
						channel: input.channel,
						locale: input.locale,
						source: input.source,
						compiledWarning: input.compiledWarning ?? null,
						version: nextVersion,
						createdByUserId: input.createdByUserId,
						updatedByUserId: input.updatedByUserId,
					})
					.returning();
				return this.mapRow(row);
			});
		} catch (err) {
			if (isUniqueViolation(err)) {
				throw new EmitoError({
					code: EMITO_ERROR_CODE.RESOURCE_CONFLICT,
					message: `Concurrent template-override version conflict for ${input.eventKey}/${input.channel}/${input.locale}`,
					isRetryable: true,
					context: { eventKey: input.eventKey, channel: input.channel, locale: input.locale },
					cause: err instanceof Error ? err : undefined,
				});
			}
			throw err;
		}
	}

	async history(
		eventKey: string,
		channel: string,
		locale: string,
		limit: number,
	): Promise<readonly TemplateOverrideRecord[]> {
		const rows = await this.db
			.select()
			.from(emito_template_overrides)
			.where(this.tripleWhere(eventKey, channel, locale))
			.orderBy(desc(emito_template_overrides.version))
			.limit(Math.max(0, limit));
		return rows.map((r) => this.mapRow(r));
	}

	private tripleWhere(eventKey: string, channel: string, locale: string) {
		return and(
			eq(emito_template_overrides.eventKey, eventKey),
			eq(emito_template_overrides.channel, channel),
			eq(emito_template_overrides.locale, locale),
		);
	}

	// biome-ignore lint/suspicious/noExplicitAny: Drizzle select result type is complex
	private mapRow(row: any): TemplateOverrideRecord {
		return {
			id: row.id,
			eventKey: row.eventKey,
			channel: row.channel as TemplateOverrideChannel,
			locale: row.locale,
			source: row.source,
			compiledWarning: row.compiledWarning ?? null,
			version: row.version,
			createdByUserId: row.createdByUserId,
			updatedByUserId: row.updatedByUserId,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
		};
	}
}

/** Narrow an unknown thrown value to a Postgres unique-violation (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
	return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}
