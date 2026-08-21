const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Formats a date as a human-readable relative time string.
 *
 * Returns "just now" for <60s, "Nm ago" for minutes, "Nh ago" for hours,
 * "Yesterday" for 1 day, "Nd ago" for 2-6 days, and a short date for older.
 */
export function formatRelativeTime(date: string | Date): string {
	const then = typeof date === "string" ? new Date(date) : date;
	const now = Date.now();
	const diff = now - then.getTime();

	if (diff < MINUTE) return "just now";
	if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
	if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
	if (diff < 2 * DAY) return "Yesterday";
	if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;

	return then.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		year: then.getFullYear() !== new Date(now).getFullYear() ? "numeric" : undefined,
	});
}
