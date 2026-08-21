/**
 * Compile-time assertion that two types are identical.
 * Used for schema drift detection — ensures Zod inferred types match TS types.
 */
export type AssertEqual<T, U> = [T] extends [U] ? ([U] extends [T] ? true : never) : never;
