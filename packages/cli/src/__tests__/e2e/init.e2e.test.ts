import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyDelivery } from "../../steps/verify-delivery.js";
import type { Wizard } from "../../wizard.js";

// `installPackages` shells out to the consumer's package manager (`pnpm add @emito/core ...`).
// The `@emito/*` packages are internal workspace packages, not published to the npm
// registry, so a real install would 404. That step is covered by unit tests
// (`../init-command.test.ts`) that assert it's invoked with the right args; here we
// stub it so this test can focus on its actual job: prove the *generated* files
// (emito.config.ts / emito.mount.ts) compile and boot a real EmitoServer against real
// Postgres/Redis. Everything else in `runInit` (prerequisite check, migration, file
// generation) runs for real.
vi.mock("../../steps/install-packages.js", () => ({
	installPackages: vi.fn().mockResolvedValue(undefined),
	packagesToInstall: vi
		.fn()
		.mockReturnValue([
			"@emito/core",
			"@emito/server",
			"@emito/db",
			"@emito/auth-jwt",
			"@emito/react",
		]),
}));

// Fixture dir lives *inside* packages/cli (not os.tmpdir()) so that when we dynamically
// import the generated emito.mount.ts, Node's bare-specifier resolution (which walks up
// through parent node_modules directories) finds `@emito/core`, `@emito/server`,
// `@emito/auth-jwt`, `@emito/db` symlinked into packages/cli/node_modules by pnpm.
const e2eDir = dirname(fileURLToPath(import.meta.url));

describe("emito init end-to-end", () => {
	let pg: Awaited<ReturnType<PostgreSqlContainer["start"]>>;
	let redis: Awaited<ReturnType<RedisContainer["start"]>>;
	let dir: string;

	beforeAll(async () => {
		pg = await new PostgreSqlContainer("postgres:16").start();
		redis = await new RedisContainer("redis:7").start();
	}, 60_000);

	afterAll(async () => {
		await pg.stop();
		await redis.stop();
	});

	beforeEach(() => {
		dir = mkdtempSync(join(e2eDir, ".fixture-"));
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ dependencies: { fastify: "^5.0.0" } }),
		);
		writeFileSync(join(dir, "pnpm-lock.yaml"), "");
		// This suite dynamically imports the generated emito.mount.ts through vitest's
		// Vite-powered loader (which transforms .ts on the fly) — a tsconfig.json here
		// keeps `runInit` generating .ts (see detectProjectLanguage), matching what the
		// dynamic import below expects.
		writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({ compilerOptions: {} }));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		// `process.env.KEY = undefined` does NOT unset the variable — Node coerces
		// via String(undefined), leaving `"KEY" in process.env === true`. Use
		// Reflect.deleteProperty (biome's `lint/performance/noDelete` disallows the
		// bare `delete` operator, but this achieves the same real removal).
		for (const key of ["DATABASE_URL", "REDIS_URL", "EMITO_JWT_SECRET", "EMITO_API_KEY"]) {
			Reflect.deleteProperty(process.env, key);
		}
	});

	it("generates a glue scaffold that compiles and mounts a working Emito server", async () => {
		const fakeWizard: Wizard = {
			selectChannels: async () => [],
			promptMissingEnvVar: async () => "",
			selectFramework: async (suggested) => suggested,
			confirmPlan: async () => true,
		};

		const databaseUrl = pg.getConnectionUri();
		const redisUrl = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;

		const { runInit } = await import("../../commands/init.js");
		const result = await runInit({
			cwd: dir,
			env: { DATABASE_URL: databaseUrl, REDIS_URL: redisUrl },
			channels: [],
			wizard: fakeWizard,
		});

		expect(result.status).toBe("manual-mount-required");
		expect(result.framework).toBe("fastify");
		expect(result.generatedFiles).toHaveLength(2);

		process.env.DATABASE_URL = databaseUrl;
		process.env.REDIS_URL = redisUrl;
		process.env.EMITO_JWT_SECRET = "e2e-test-secret";
		process.env.EMITO_API_KEY = "e2e-test-api-key";

		const mountPath = join(dir, "emito.mount.ts");
		const mod = (await import(pathToFileURL(mountPath).href)) as {
			buildEmitoServer: () => Promise<{
				server: {
					prefix: string;
					handler: (request: Request) => Promise<Response>;
				};
				cleanup: () => Promise<void>;
			}>;
		};
		const { server, cleanup } = await mod.buildEmitoServer();
		expect(server.prefix).toBe("/emito");
		expect(typeof cleanup).toBe("function");

		// Prove the returned EmitoServer actually routes real HTTP-shaped requests —
		// not just that construction didn't throw. GET /emito/health is public (no
		// auth) and internally calls `emito.healthCheck()`, which touches the real
		// Postgres/Redis connections wired up by the generated emito.config.ts.
		const healthResponse = await server.handler(
			new Request("http://localhost/emito/health", { method: "GET" }),
		);
		expect(healthResponse.status).toBe(200);
		// Responses are wrapped as `{ data: ... }` by `jsonResponse` (see
		// packages/server/src/response.ts).
		const healthBody = (await healthResponse.json()) as { data: { healthy: boolean } };
		expect(healthBody.data.healthy).toBe(true);

		// Prove real notification delivery end-to-end: import the generated
		// emito.config.ts directly (in addition to emito.mount.ts) to get at the
		// real `emito` instance and its real (Drizzle-backed) inbox repository —
		// no mocks — and drive them through the CLI's own `verifyDelivery` step,
		// the same helper the plan calls out as the delivery proof-of-correctness
		// primitive.
		const configPath = join(dir, "emito.config.ts");
		const configMod = (await import(pathToFileURL(configPath).href)) as {
			createEmitoRuntime: () => Promise<{
				emito: {
					send(params: {
						event: string;
						subscriberId: string;
						payload: Record<string, unknown>;
						recipient?: Record<string, unknown>;
					}): Promise<unknown>;
				};
				repositories: {
					inboxRepository: {
						findBySubscriber: (
							subscriberId: string,
						) => Promise<{ items: Array<{ eventType: string }> }>;
					};
				};
				cleanup: () => Promise<void>;
			}>;
		};
		const runtime = await configMod.createEmitoRuntime();
		try {
			const delivered = await verifyDelivery({
				send: (event, subscriberId, payload) =>
					// `recipient: {}` (truthy but empty) lets `resolveSubscriber` auto-create
					// a minimal, no-email/phone subscriber for this never-seen-before test
					// subscriber id — the inApp channel used here doesn't need contact info.
					runtime.emito.send({ event, subscriberId, payload, recipient: {} }),
				listInbox: async (subscriberId) => {
					const { items } =
						await runtime.repositories.inboxRepository.findBySubscriber(subscriberId);
					return items.map((item) => ({ event: item.eventType }));
				},
			});
			expect(delivered).toBe(true);
		} finally {
			await runtime.cleanup();
			// The generated `buildEmitoServer()` hands back its own cleanup handle —
			// exercise it so the mounted runtime is shut down too (proves the shutdown
			// path the generated scaffold advertises actually works).
			await cleanup();
		}
	}, 30_000);
});
