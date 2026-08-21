import "dotenv/config";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDrizzleClient } from "@emito/db";
import { createEmitoServer } from "@emito/server";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import express from "express";
import jwt from "jsonwebtoken";
import { DEMO_USERS, createLoginHandler, createSubscriberResolver } from "./auth.js";
import { DEMO_CATEGORIES, createDemoEmito } from "./emito-config.js";
import { seedDemo } from "./seed.js";

const PORT = Number(process.env.PORT ?? 3001);
const JWT_SECRET = process.env.JWT_SECRET ?? "demo-jwt-secret-change-in-production";
const API_KEY = process.env.EMITO_API_KEY ?? "demo-api-key-change-in-production";
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://emito:emito@localhost:5432/emito_demo";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

/**
 * Absolute path to the canonical `@emito/db` Drizzle migration folder
 * (`packages/db/drizzle`), resolved relative to this file's location in the
 * monorepo layout (`apps/demo/server` → up three levels).
 */
const MIGRATIONS_FOLDER = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../packages/db/drizzle",
);

/**
 * Apply the `@emito/db` migrations against a dedicated, short-lived client, then
 * close it.
 *
 * Runs BEFORE {@link createDemoEmito} so the full `emito_*` schema exists before
 * anything (repositories, `emito.start()`) reads it. A separate
 * client is used deliberately: the demo's runtime client must not exist yet at the
 * point migrations run, and this one is disposed immediately after.
 *
 * @param databaseUrl - The Postgres connection URI.
 */
async function runMigrations(databaseUrl: string): Promise<void> {
	console.log(`[demo] RUN_MIGRATIONS_ON_BOOT=true — applying migrations from ${MIGRATIONS_FOLDER}`);
	const migrationDb = createDrizzleClient(databaseUrl);
	try {
		await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
		console.log("[demo] Migrations applied.");
	} finally {
		// Drizzle's postgres-js client exposes the underlying driver as `$client`.
		await (migrationDb as unknown as { $client: { end: () => Promise<void> } }).$client.end();
	}
}

async function main() {
	if (process.env.RUN_MIGRATIONS_ON_BOOT === "true") {
		await runMigrations(DATABASE_URL);
	} else {
		console.log("[demo] RUN_MIGRATIONS_ON_BOOT not set — skipping boot migrations.");
	}

	const { emito, repositories, redis, db, cleanup } = await createDemoEmito({
		databaseUrl: DATABASE_URL,
		redisUrl: REDIS_URL,
		jwtSecret: JWT_SECRET,
		apiKey: API_KEY,
		resendApiKey: process.env.RESEND_API_KEY,
		resendFrom: process.env.RESEND_FROM,
	});

	if (process.env.SEED_ON_BOOT === "true") {
		console.log("[demo] SEED_ON_BOOT=true — seeding demo fixtures...");
		await seedDemo(db);
	} else {
		console.log("[demo] SEED_ON_BOOT not set — skipping boot seed.");
	}

	const resolveSubscriberId = createSubscriberResolver(JWT_SECRET);

	const emitServer = createEmitoServer({
		emito,
		apiKey: API_KEY,
		prefix: "/emito",
		repositories,
		redisClient: redis,
		resolveSubscriberId,
		resolveWorkspaceRole: async (_req, _wsId) => "admin",
		includeErrorContext: true,
	});

	const nodeHandler = (await import("@emito/server")).toNodeHandler(emitServer);
	const upgradeHandler = (await import("@emito/server")).toNodeUpgradeHandler(emitServer);

	const app = express();

	app.all("/emito/*", (req, res) => nodeHandler(req, res));
	app.all("/emito", (req, res) => nodeHandler(req, res));

	app.use(express.json());

	app.post("/login", createLoginHandler(JWT_SECRET));

	app.get("/api/users", (_req, res) => {
		const users = Object.values(DEMO_USERS).map(({ id, name, email, role }) => ({ id, name, email, role }));
		res.json(users);
	});

	app.get("/api/topics", (_req, res) => {
		// Map Emito category policies to PreferenceCenter category types
		const policyToCategory: Record<string, string> = {
			always: "transactional",
			opt_out: "product",
			opt_in: "marketing",
		};
		const topics = Object.entries(DEMO_CATEGORIES).flatMap(([_category, config]) =>
			Object.entries(config.topics).map(([topicKey, topic]) => ({
				topicKey,
				label: topic.description,
				category: policyToCategory[config.policy] ?? "product",
				channels: [...topic.channels],
			})),
		);
		res.json(topics);
	});

	const EVENT_TEMPLATES: Record<string, Record<string, unknown>> = {
		"order.fill": {
			symbol: "AAPL",
			shares: 100,
			price: "$187.42",
			side: "buy",
		},
		"price.alert": {
			symbol: "TSLA",
			threshold: "$245.00",
			currentPrice: "$247.83",
			direction: "above",
		},
		"security.alert": {
			description: "New login detected from San Francisco, CA on Chrome/macOS",
			device: "Chrome/macOS",
			location: "San Francisco, CA",
		},
		"team.invite": {
			team: "Quant Strategies",
			inviterName: "Bob",
		},
	};

	app.post("/api/trigger/:event", async (req, res) => {
		const authHeader = req.headers.authorization;
		if (!authHeader?.startsWith("Bearer ")) {
			res.status(401).json({ error: "Missing authorization token" });
			return;
		}

		let subscriberId: string;
		try {
			const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as { subscriberId: string };
			subscriberId = decoded.subscriberId;
		} catch {
			res.status(401).json({ error: "Invalid or expired token" });
			return;
		}

		const { event } = req.params;
		const { workspaceId, payload } = req.body as {
			workspaceId?: string;
			payload?: Record<string, unknown>;
		};

		const template = EVENT_TEMPLATES[event as string];
		if (!template) {
			res.status(400).json({ error: `Unknown event: ${event}` });
			return;
		}

		try {
			const result = await emito.send({
				event: event as string,
				subscriberId,
				workspaceId,
				payload: { ...template, ...payload },
			});
			res.json(result);
		} catch (err: unknown) {
			console.error("[trigger] Error:", err);
			const emitErr = err as { code?: string; statusCode?: number; message?: string };
			if (emitErr.code === "CONSENT_REQUIRED") {
				res.status(403).json({ error: "User has not opted in to this notification topic. Enable it in Settings first." });
			} else {
				res.status(emitErr.statusCode ?? 500).json({ error: "Notification delivery failed" });
			}
		}
	});

	const isDev = process.env.NODE_ENV !== "production";

	if (isDev) {
		const { createServer: createViteServer } = await import("vite");
		const { fileURLToPath } = await import("node:url");
		const clientRoot = fileURLToPath(new URL("../client", import.meta.url));
		const monorepoRoot = path.resolve(import.meta.dirname, "../../..");
		const vite = await createViteServer({
			root: clientRoot,
			configFile: path.resolve(clientRoot, "vite.config.ts"),
			server: {
				middlewareMode: true,
				fs: { allow: [monorepoRoot], strict: false },
			},
			appType: "spa",
		});
		app.use(vite.middlewares);
	} else {
		const clientDist = path.resolve(import.meta.dirname, "../client/dist");
		app.use(express.static(clientDist));
		app.get("*", (_req, res) => {
			res.sendFile(path.join(clientDist, "index.html"));
		});
	}

	const httpServer = createHttpServer(app);

	httpServer.on("upgrade", (req, socket, head) => {
		upgradeHandler(req, socket, head);
	});

	httpServer.listen(PORT, () => {
		console.log(`[demo] Server running at http://localhost:${PORT}`);
		console.log(`[demo] Emito API at http://localhost:${PORT}/emito`);
	});

	const shutdown = async () => {
		console.log("[demo] Shutting down...");
		httpServer.close();
		await cleanup();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

main().catch((err) => {
	console.error("[demo] Failed to start:", err);
	process.exit(1);
});
