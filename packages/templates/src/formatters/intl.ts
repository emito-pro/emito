/**
 * Intl formatter utilities for locale-aware formatting.
 *
 * All functions accept a RenderContext to derive locale and timezone.
 * Invalid locale/timezone values produce fallback formatting using 'en'/'UTC' (no errors thrown).
 */

import type { RenderContext } from "@emito/types";

const FALLBACK_CTX: RenderContext = { locale: "en", timezone: "UTC" };

export function formatDate(date: Date | string | number, ctx: RenderContext): string {
	const d = date instanceof Date ? date : new Date(date);
	try {
		return new Intl.DateTimeFormat(ctx.locale, {
			dateStyle: "medium",
			timeZone: ctx.timezone,
		}).format(d);
	} catch {
		return new Intl.DateTimeFormat(FALLBACK_CTX.locale, {
			dateStyle: "medium",
			timeZone: FALLBACK_CTX.timezone,
		}).format(d);
	}
}

export function formatTime(date: Date | string | number, ctx: RenderContext): string {
	const d = date instanceof Date ? date : new Date(date);
	try {
		return new Intl.DateTimeFormat(ctx.locale, {
			timeStyle: "short",
			timeZone: ctx.timezone,
		}).format(d);
	} catch {
		return new Intl.DateTimeFormat(FALLBACK_CTX.locale, {
			timeStyle: "short",
			timeZone: FALLBACK_CTX.timezone,
		}).format(d);
	}
}

export function formatDateTime(date: Date | string | number, ctx: RenderContext): string {
	const d = date instanceof Date ? date : new Date(date);
	try {
		return new Intl.DateTimeFormat(ctx.locale, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: ctx.timezone,
		}).format(d);
	} catch {
		return new Intl.DateTimeFormat(FALLBACK_CTX.locale, {
			dateStyle: "medium",
			timeStyle: "short",
			timeZone: FALLBACK_CTX.timezone,
		}).format(d);
	}
}

export function formatCurrency(amount: number, currency: string, ctx: RenderContext): string {
	try {
		return new Intl.NumberFormat(ctx.locale, {
			style: "currency",
			currency,
		}).format(amount);
	} catch {
		return new Intl.NumberFormat(FALLBACK_CTX.locale, {
			style: "currency",
			currency: "USD",
		}).format(amount);
	}
}

export function formatNumber(value: number, ctx: RenderContext): string {
	try {
		return new Intl.NumberFormat(ctx.locale).format(value);
	} catch {
		return new Intl.NumberFormat(FALLBACK_CTX.locale).format(value);
	}
}

export interface PluralForms {
	one: string;
	other: string;
	zero?: string;
	two?: string;
	few?: string;
	many?: string;
}

export function formatPlural(count: number, forms: PluralForms, ctx: RenderContext): string {
	try {
		const rule = new Intl.PluralRules(ctx.locale).select(count);
		return (forms as unknown as Record<string, string | undefined>)[rule] ?? forms.other;
	} catch {
		const rule = new Intl.PluralRules(FALLBACK_CTX.locale).select(count);
		return (forms as unknown as Record<string, string | undefined>)[rule] ?? forms.other;
	}
}
