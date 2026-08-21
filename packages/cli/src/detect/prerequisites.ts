import Redis from "ioredis";
import postgres from "postgres";

export interface PrerequisiteEnv {
	DATABASE_URL?: string;
	REDIS_URL?: string;
}

export interface PrerequisiteResult {
	databaseUrl: string | null;
	redisUrl: string | null;
	databaseReachable: boolean;
	redisReachable: boolean;
	/**
	 * Why the database ping failed. `undefined` when the ping succeeded *or* when
	 * no `DATABASE_URL` was supplied at all (a missing URL is not a connection
	 * error — the caller can still prompt for one).
	 */
	databaseError?: string;
	/** Why the Redis ping failed — see `databaseError` for the `undefined` cases. */
	redisError?: string;
}

interface PingResult {
	reachable: boolean;
	error?: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function pingDatabase(url: string): Promise<PingResult> {
	const sql = postgres(url, { max: 1, connect_timeout: 3 });
	try {
		await sql`select 1`;
		return { reachable: true };
	} catch (error) {
		// Keep the real reason — the user needs to know *why* (bad password, no
		// route to host, database does not exist), not just "unreachable".
		return { reachable: false, error: errorMessage(error) };
	} finally {
		await sql.end({ timeout: 1 });
	}
}

async function pingRedis(url: string): Promise<PingResult> {
	const client = new Redis(url, {
		lazyConnect: true,
		connectTimeout: 3000,
		maxRetriesPerRequest: 1,
		retryStrategy: () => null,
	});
	try {
		await client.connect();
		await client.ping();
		return { reachable: true };
	} catch (error) {
		return { reachable: false, error: errorMessage(error) };
	} finally {
		client.disconnect();
	}
}

export async function checkPrerequisites(env: PrerequisiteEnv): Promise<PrerequisiteResult> {
	const databaseUrl = env.DATABASE_URL ?? null;
	const redisUrl = env.REDIS_URL ?? null;

	const database = databaseUrl !== null ? await pingDatabase(databaseUrl) : { reachable: false };
	const redis = redisUrl !== null ? await pingRedis(redisUrl) : { reachable: false };

	return {
		databaseUrl,
		redisUrl,
		databaseReachable: database.reachable,
		redisReachable: redis.reachable,
		databaseError: database.error,
		redisError: redis.error,
	};
}
