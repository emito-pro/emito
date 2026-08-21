import type { InAppAction } from "./templates.js";

export interface NotificationEvent {
	notificationId: string;
	subscriberId: string;
	event: string;
	category?: string;
	topic?: string;
	subject?: string;
	body: string;
	avatar?: string;
	actionUrl?: string;
	primaryAction?: InAppAction;
	secondaryAction?: InAppAction;
	data?: Record<string, unknown>;
	timestamp: Date;
}

export interface EmitoTransport {
	connect(endpoint: string, token: string): Promise<void>;
	subscribe(topics: string[]): void;
	onMessage(handler: (event: NotificationEvent) => void): void;
	disconnect(): void;
	readonly type: "websocket" | "sse" | "polling";
	readonly connected: boolean;
}
