import type { DeliveryStatus } from "@emito/types";
import type {
	CreateNotificationData,
	CursorResult,
	NotificationFilter,
	NotificationRecord,
	UpdateNotificationStatusData,
} from "./types";

export interface NotificationRepository {
	create(data: CreateNotificationData): Promise<NotificationRecord>;
	updateStatus(
		id: string,
		status: DeliveryStatus,
		metadata?: UpdateNotificationStatusData,
	): Promise<void>;
	findById(id: string): Promise<NotificationRecord | null>;
	findByProviderMsgId(providerMsgId: string): Promise<NotificationRecord | null>;
	list(
		subscriberId: string,
		filter?: NotificationFilter,
	): Promise<CursorResult<NotificationRecord>>;
	listCrossWorkspace(filter?: NotificationFilter): Promise<CursorResult<NotificationRecord>>;
}
