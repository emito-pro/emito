import { z } from "zod";
import type { Channel } from "../channels";
import type { AssertEqual } from "../type-utils";

export const ChannelSchema = z.enum([
	"email",
	"sms",
	"push",
	"inApp",
	"webhook",
	"slack",
	"telegram",
	"discord",
	"whatsapp",
	"webPush",
]) satisfies z.ZodType<Channel>;

type _AssertChannel = AssertEqual<z.infer<typeof ChannelSchema>, Channel>;
