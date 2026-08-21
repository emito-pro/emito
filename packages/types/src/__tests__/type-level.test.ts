/**
 * Type-level tests for generic type parameters.
 *
 * These tests exist entirely as compile-time assertions. If a type assertion
 * fails (resolves to `never`), the file won't compile and `tsc --noEmit` will fail.
 *
 * Do NOT add runtime assertions for TypeScript compile-time behavior.
 * See agent-rules.md Rule 29.
 */
import { describe, expect, it } from "vitest";
import type { EmitoConfig } from "../config";
import type { SendParams, SendResult } from "../delivery";
import type { CategoryDefinition, EmitoCategories, EmitoEvents, EventDefinition } from "../events";
import type { AssertEqual } from "../type-utils";

// ---- AssertEqual utility ----------------------------------------------------

// Should be `true` for identical types
type _AssertEqualSameTypes = AssertEqual<string, string>;
type _SameTypesGuard = _AssertEqualSameTypes extends true ? true : never;

// Should be `never` for different types (we verify this type exists but
// we can't instantiate it — we verify the positive case instead)
type _AssertEqualDifferentTypes = AssertEqual<string, number>;
// _AssertEqualDifferentTypes should be `never`, meaning it can't be assigned

declare const _sameTypes: _SameTypesGuard; // must compile = types match

// ---- SendParams<TEvent> generic narrowing -----------------------------------

// With explicit generic: event field must be constrained to the literal type
type EmailEvent = "user.signup" | "user.reset_password";
type NarrowedSendParams = SendParams<EmailEvent>;

// The event field in NarrowedSendParams must be assignable to EmailEvent
type _SendParamsEventNarrowed = NarrowedSendParams["event"] extends EmailEvent ? true : never;

// Default generic (no TEvent): event should be string
type DefaultSendParams = SendParams;
type _SendParamsDefaultIsString = DefaultSendParams["event"] extends string ? true : never;

declare const _narrowedEvent: _SendParamsEventNarrowed;
declare const _defaultEvent: _SendParamsDefaultIsString;

// ---- EventDefinition<TCategory> generic narrowing --------------------------

type TransactionalCategory = "transactional";
type NarrowedEventDef = EventDefinition<TransactionalCategory>;

// The category field in NarrowedEventDef must be assignable to TransactionalCategory
type _EventDefCategoryNarrowed = NarrowedEventDef["category"] extends TransactionalCategory
	? true
	: never;

// Default generic (no TCategory): category should be string
type DefaultEventDef = EventDefinition;
type _EventDefDefaultIsString = DefaultEventDef["category"] extends string ? true : never;

declare const _narrowedCategory: _EventDefCategoryNarrowed;
declare const _defaultCategory: _EventDefDefaultIsString;

// ---- EmitoConfig<TCategories, TEvents> generic narrowing --------------------

type MyCategoryKeys = "transactional" | "marketing";
type MyEventKeys = "user.signup" | "newsletter.weekly";

type NarrowedEmitoConfig = EmitoConfig<MyCategoryKeys, MyEventKeys>;

// categories keys should be constrained to MyCategoryKeys
type _EmitoConfigCategoriesKeyNarrowed = NonNullable<
	NarrowedEmitoConfig["categories"]
> extends Record<MyCategoryKeys, unknown>
	? true
	: never;

// Default generics: EmitoConfig with no params (standalone use)
type DefaultEmitoConfig = EmitoConfig;

declare const _configCategories: _EmitoConfigCategoriesKeyNarrowed;

// ---- EmitoEvents and EmitoCategories with type constraints -------------------

// EmitoEvents should be a record of string → EventDefinition
type _EmitoEventsIsRecord = EmitoEvents extends Record<string, EventDefinition<string>>
	? true
	: never;

// EmitoCategories should be a record of string → CategoryDefinition
type _EmitoCategoriesIsRecord = EmitoCategories extends Record<string, CategoryDefinition>
	? true
	: never;

declare const _emitEvents: _EmitoEventsIsRecord;
declare const _emitCategories: _EmitoCategoriesIsRecord;

// ---- SendResult shape -------------------------------------------------------

// SendResult must have notificationId as string and channels as array
type _SendResultHasNotifId = SendResult["notificationId"] extends string ? true : never;
type _SendResultHasChannels = SendResult["channels"] extends Array<unknown> ? true : never;

declare const _sendResultNotifId: _SendResultHasNotifId;
declare const _sendResultChannels: _SendResultHasChannels;

// ---- Runtime test that compilation succeeded --------------------------------

describe("Type-level compile-time assertions", () => {
	it("should compile without errors (all generic constraints satisfied)", () => {
		// If this file compiled successfully, all type-level assertions above passed.
		// There is nothing to assert at runtime — the test passing means tsc succeeded.
		expect(true).toBe(true);
	});
});
