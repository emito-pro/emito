import { z } from "zod";
import type { DeliveryStatus } from "../status";
import type { AssertEqual } from "../type-utils";

export const DeliveryStatusSchema = z.enum([
	"pending",
	"sent",
	"delivered",
	"deferred",
	"bounced",
	"failed",
	"suppressed",
	"complained",
	"opened",
	"machine_opened",
	"clicked",
	"unsubscribed",
	"read",
	"digested",
	"blocked_by_preference",
	"blocked_by_consent",
	"blocked_by_admin",
]);

type _AssertDeliveryStatus = AssertEqual<z.infer<typeof DeliveryStatusSchema>, DeliveryStatus>;
