import { z } from "zod";

export const EmitoTransportConfigSchema = z.object({
	type: z.enum(["websocket", "sse", "polling"]),
});
