import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Request, Response, Router } from "express";
import type { EmitoServer } from "../handler.js";
import { toNodeHandler, toNodeUpgradeHandler } from "./node.js";

export interface EmitoRouterResult {
	router: Router;
	upgradeHandler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void;
}

export function emitRouter(
	server: EmitoServer,
	express: { Router: () => Router },
): EmitoRouterResult {
	const router = express.Router();
	const nodeHandler = toNodeHandler(server);
	router.all("*", (req: Request, res: Response) => nodeHandler(req, res));
	const upgradeHandler = toNodeUpgradeHandler(server);
	return { router, upgradeHandler };
}
