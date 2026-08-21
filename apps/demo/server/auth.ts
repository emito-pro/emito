import { createJwtAuth } from "@emito/auth-jwt";
import type { Request as ExpressRequest, Response } from "express";
import jwt from "jsonwebtoken";

export interface DemoUser {
	id: string;
	name: string;
	email: string;
	role: "trader" | "admin";
}

export const DEMO_USERS: Record<string, DemoUser> = {
	trader_alice: {
		id: "trader_alice",
		name: "Alice Chen",
		email: "alice@demo.emito.dev",
		role: "trader",
	},
	trader_bob: {
		id: "trader_bob",
		name: "Bob Martinez",
		email: "bob@demo.emito.dev",
		role: "trader",
	},
	admin_charlie: {
		id: "admin_charlie",
		name: "Charlie Park",
		email: "charlie@demo.emito.dev",
		role: "admin",
	},
};

export function createLoginHandler(jwtSecret: string) {
	return (req: ExpressRequest, res: Response) => {
		const { userId } = req.body as { userId?: string };

		if (!userId || !DEMO_USERS[userId]) {
			res.status(400).json({ error: "Invalid userId. Use: trader_alice, trader_bob, or admin_charlie" });
			return;
		}

		const user = DEMO_USERS[userId]!;
		const token = jwt.sign(
			{ subscriberId: user.id, email: user.email, role: user.role },
			jwtSecret,
			{ algorithm: "HS256", expiresIn: "24h" },
		);

		res.cookie("emito_token", token, { httpOnly: true, sameSite: "lax", path: "/" });
		res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
	};
}

export function createSubscriberResolver(jwtSecret: string) {
	const jwtAuth = createJwtAuth({ hmacSecret: jwtSecret });

	// Extends JWT auth to also check emito_token cookie (for browser WebSocket upgrades).
	// Receives a Web-standard Request (per ResolveSubscriberId), so headers are read via `.get(...)`.
	return async (req: Request): Promise<string | null> => {
		const result = await jwtAuth(req);
		if (result) return result;

		const cookieHeader = req.headers.get("cookie");
		if (!cookieHeader) return null;

		const match = cookieHeader.match(/emito_token=([^;]+)/);
		if (!match?.[1]) return null;

		try {
			const decoded = jwt.verify(match[1], jwtSecret) as { subscriberId?: string };
			return typeof decoded.subscriberId === "string" ? decoded.subscriberId : null;
		} catch {
			return null;
		}
	};
}
