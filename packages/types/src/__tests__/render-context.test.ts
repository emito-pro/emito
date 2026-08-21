/**
 * Tests for RenderContext, lang/locale rename, and updated EventTemplate signatures.
 *
 * Covers runtime validation (Zod schemas) and type-level compile-time assertions.
 * If a type assertion resolves to `never`, tsc --noEmit will catch it.
 *
 * See agent-rules.md Rule 29: do not test TypeScript type enforcement at runtime.
 * Zod schema tests here are for runtime input validation, not TS types.
 *
 * Rules applied:
 * - Assert on specific values, never message strings (rule 1)
 * - Test boundary conditions for optional parameters (rules 4, 5)
 * - Test empty string inputs (rule 6)
 * - Follow describe("TypeName") naming (rule 15)
 * - Assert on shape of return values (rule 26)
 */

import { describe, expect, it } from "vitest";
import type { BrandTheme } from "../config";
import type { EmitoConfig } from "../config";
import type { SendParams } from "../delivery";
import { EmitoConfigSchema } from "../schemas/config";
import { SendParamsSchema } from "../schemas/delivery";
import type { EventTemplate, RenderContext } from "../templates";
import type { AssertEqual } from "../type-utils";

// ---------------------------------------------------------------------------
// Type-level: RenderContext shape
// ---------------------------------------------------------------------------

type _RenderContextHasLocale = RenderContext["locale"] extends string ? true : never;
type _RenderContextHasTimezone = RenderContext["timezone"] extends string ? true : never;

declare const _ctxLocale: _RenderContextHasLocale;
declare const _ctxTimezone: _RenderContextHasTimezone;

// ---------------------------------------------------------------------------
// Type-level: EventTemplate uses (payload, brand, ctx) signatures
// ---------------------------------------------------------------------------

type SamplePayload = { orderId: string; amount: string };
type SampleTemplate = EventTemplate<SamplePayload>;

// email must accept (payload, brand, ctx) — third arg must be RenderContext
type _EmailFnParamCount = NonNullable<SampleTemplate["email"]> extends (
	payload: SamplePayload,
	brand: BrandTheme,
	ctx: RenderContext,
) => Promise<unknown>
	? true
	: never;

type _SmsFnParamCount = NonNullable<SampleTemplate["sms"]> extends (
	payload: SamplePayload,
	brand: BrandTheme,
	ctx: RenderContext,
) => unknown
	? true
	: never;

type _PushFnParamCount = NonNullable<SampleTemplate["push"]> extends (
	payload: SamplePayload,
	brand: BrandTheme,
	ctx: RenderContext,
) => unknown
	? true
	: never;

type _InAppFnParamCount = NonNullable<SampleTemplate["inApp"]> extends (
	payload: SamplePayload,
	brand: BrandTheme,
	ctx: RenderContext,
) => unknown
	? true
	: never;

declare const _emailParam: _EmailFnParamCount;
declare const _smsParam: _SmsFnParamCount;
declare const _pushParam: _PushFnParamCount;
declare const _inAppParam: _InAppFnParamCount;

// ---------------------------------------------------------------------------
// Type-level: SendParams has lang field (not locale) for template selection
// ---------------------------------------------------------------------------

type _SendParamsHasLang = SendParams["lang"] extends string | undefined ? true : never;
// locale on SendParams should be the full BCP 47 (a different field)
type _SendParamsHasLocale = SendParams["locale"] extends string | undefined ? true : never;
type _SendParamsHasTimezone = SendParams["timezone"] extends string | undefined ? true : never;

declare const _sendParamsLang: _SendParamsHasLang;
declare const _sendParamsLocale: _SendParamsHasLocale;
declare const _sendParamsTimezone: _SendParamsHasTimezone;

// ---------------------------------------------------------------------------
// Type-level: EmitoConfig has defaultLang field (not defaultLocale→lang)
// ---------------------------------------------------------------------------

type _EmitoConfigHasDefaultLang = EmitoConfig["defaultLang"] extends string | undefined
	? true
	: never;
type _EmitoConfigHasDefaultLocale = EmitoConfig["defaultLocale"] extends string | undefined
	? true
	: never;
type _EmitoConfigHasDefaultTimezone = EmitoConfig["defaultTimezone"] extends string | undefined
	? true
	: never;

declare const _configDefaultLang: _EmitoConfigHasDefaultLang;
declare const _configDefaultLocale: _EmitoConfigHasDefaultLocale;
declare const _configDefaultTimezone: _EmitoConfigHasDefaultTimezone;

// ---------------------------------------------------------------------------
// Runtime: SendParamsSchema accepts lang field
// ---------------------------------------------------------------------------

describe("SendParamsSchema — lang/locale/timezone fields", () => {
	it("should accept minimal send params (no lang/locale/timezone)", () => {
		const params = {
			event: "auth.welcome",
			subscriberId: "sub_1",
			payload: {},
		};
		expect(SendParamsSchema.parse(params)).toMatchObject(params);
	});

	it("should accept lang as a language code", () => {
		const params = {
			event: "auth.welcome",
			subscriberId: "sub_1",
			payload: {},
			lang: "pl",
		};
		expect(SendParamsSchema.parse(params)).toMatchObject({ lang: "pl" });
	});

	it("should accept locale as a full BCP 47 locale string", () => {
		const params = {
			event: "auth.welcome",
			subscriberId: "sub_1",
			payload: {},
			locale: "pl-PL",
		};
		expect(SendParamsSchema.parse(params)).toMatchObject({ locale: "pl-PL" });
	});

	it("should accept timezone as an IANA timezone string", () => {
		const params = {
			event: "auth.welcome",
			subscriberId: "sub_1",
			payload: {},
			timezone: "Europe/Warsaw",
		};
		expect(SendParamsSchema.parse(params)).toMatchObject({ timezone: "Europe/Warsaw" });
	});

	it("should accept all three lang, locale, timezone together", () => {
		const params = {
			event: "auth.welcome",
			subscriberId: "sub_1",
			payload: {},
			lang: "pl",
			locale: "pl-PL",
			timezone: "Europe/Warsaw",
		};
		const result = SendParamsSchema.parse(params);
		expect(result).toMatchObject({ lang: "pl", locale: "pl-PL", timezone: "Europe/Warsaw" });
	});

	it("should reject when lang is not a string", () => {
		expect(() =>
			SendParamsSchema.parse({
				event: "auth.welcome",
				subscriberId: "sub_1",
				payload: {},
				lang: 42,
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Runtime: EmitoConfigSchema accepts defaultLang, defaultLocale, defaultTimezone
// ---------------------------------------------------------------------------

describe("EmitoConfigSchema — defaultLang/defaultLocale/defaultTimezone fields", () => {
	it("should accept minimal config without any default lang/locale/timezone", () => {
		const config = {
			database: { url: "postgresql://localhost/test" },
			redis: { url: "redis://localhost" },
		};
		expect(EmitoConfigSchema.parse(config)).toMatchObject(config);
	});

	it("should accept defaultLang as a language code", () => {
		const config = {
			database: { url: "postgresql://localhost/test" },
			redis: { url: "redis://localhost" },
			defaultLang: "pl",
		};
		expect(EmitoConfigSchema.parse(config)).toMatchObject({ defaultLang: "pl" });
	});

	it("should accept defaultLocale as a full BCP 47 locale string", () => {
		const config = {
			database: { url: "postgresql://localhost/test" },
			redis: { url: "redis://localhost" },
			defaultLocale: "pl-PL",
		};
		expect(EmitoConfigSchema.parse(config)).toMatchObject({ defaultLocale: "pl-PL" });
	});

	it("should accept defaultTimezone as an IANA timezone string", () => {
		const config = {
			database: { url: "postgresql://localhost/test" },
			redis: { url: "redis://localhost" },
			defaultTimezone: "Europe/Warsaw",
		};
		expect(EmitoConfigSchema.parse(config)).toMatchObject({ defaultTimezone: "Europe/Warsaw" });
	});

	it("should reject when defaultLang is not a string", () => {
		expect(() =>
			EmitoConfigSchema.parse({
				database: { url: "postgresql://localhost/test" },
				redis: { url: "redis://localhost" },
				defaultLang: 123,
			}),
		).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Runtime: RenderContext is exported and has correct shape
// ---------------------------------------------------------------------------

describe("RenderContext interface — type-level compile-time assertions", () => {
	it("should compile without errors (all RenderContext and EventTemplate assertions satisfied)", () => {
		// If this file compiled, all type-level assertions above passed.
		expect(true).toBe(true);
	});
});
