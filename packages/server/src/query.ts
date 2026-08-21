export function parseQueryString(url: URL): Record<string, string | string[]> {
	const result: Record<string, string | string[]> = {};
	for (const key of new Set(url.searchParams.keys())) {
		const values = url.searchParams.getAll(key);
		// biome-ignore lint/style/noNonNullAssertion: getAll() for an existing key always returns at least one element
		result[key] = values.length === 1 ? values[0]! : values;
	}
	return result;
}
