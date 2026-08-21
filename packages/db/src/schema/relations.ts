import { relations } from "drizzle-orm";
import { emito_alert_history } from "./alert-history";
import { emito_alerts } from "./alerts";
import { emito_broadcasts } from "./broadcasts";
import { emito_categories } from "./categories";
import { emito_consents } from "./consents";
import { emito_dead_letters } from "./dead-letters";
import { emito_erasure_log } from "./erasure-log";
import { emito_inbox } from "./inbox";
import { emito_integrations } from "./integrations";
import { emito_list_members } from "./list-members";
import { emito_lists } from "./lists";
import { emito_notifications } from "./notifications";
import { emito_preferences } from "./preferences";
import { emito_push_tokens } from "./push-tokens";
import { emito_subscribers } from "./subscribers";
import { emito_subscriptions } from "./subscriptions";
import { emito_suppression } from "./suppression";
import { emito_topics } from "./topics";
import { emito_webhook_deliveries } from "./webhook-deliveries";
import { emito_webhook_endpoints } from "./webhook-endpoints";
import { emito_workspace_defaults } from "./workspace-defaults";

export const subscribersRelations = relations(emito_subscribers, ({ many }) => ({
	notifications: many(emito_notifications),
	preferences: many(emito_preferences),
	subscriptions: many(emito_subscriptions),
	inboxItems: many(emito_inbox),
	pushTokens: many(emito_push_tokens),
	integrations: many(emito_integrations),
	listMemberships: many(emito_list_members),
	consents: many(emito_consents),
}));

export const notificationsRelations = relations(emito_notifications, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_notifications.subscriberId],
		references: [emito_subscribers.id],
	}),
}));

export const preferencesRelations = relations(emito_preferences, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_preferences.subscriberId],
		references: [emito_subscribers.id],
	}),
}));

export const workspaceDefaultsRelations = relations(emito_workspace_defaults, () => ({}));

export const categoriesRelations = relations(emito_categories, ({ one, many }) => ({
	parent: one(emito_categories, {
		fields: [emito_categories.parentId],
		references: [emito_categories.id],
		relationName: "categoryHierarchy",
	}),
	children: many(emito_categories, { relationName: "categoryHierarchy" }),
	topics: many(emito_topics),
	lists: many(emito_lists),
}));

export const topicsRelations = relations(emito_topics, ({ one, many }) => ({
	category: one(emito_categories, {
		fields: [emito_topics.categoryId],
		references: [emito_categories.id],
	}),
	subscriptions: many(emito_subscriptions),
}));

export const subscriptionsRelations = relations(emito_subscriptions, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_subscriptions.subscriberId],
		references: [emito_subscribers.id],
	}),
	topic: one(emito_topics, {
		fields: [emito_subscriptions.topicId],
		references: [emito_topics.id],
	}),
}));

export const inboxRelations = relations(emito_inbox, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_inbox.subscriberId],
		references: [emito_subscribers.id],
	}),
}));

export const pushTokensRelations = relations(emito_push_tokens, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_push_tokens.subscriberId],
		references: [emito_subscribers.id],
	}),
}));

export const integrationsRelations = relations(emito_integrations, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_integrations.subscriberId],
		references: [emito_subscribers.id],
	}),
}));

export const webhookEndpointsRelations = relations(emito_webhook_endpoints, ({ many }) => ({
	deliveries: many(emito_webhook_deliveries),
}));

export const webhookDeliveriesRelations = relations(emito_webhook_deliveries, ({ one }) => ({
	endpoint: one(emito_webhook_endpoints, {
		fields: [emito_webhook_deliveries.endpointId],
		references: [emito_webhook_endpoints.id],
	}),
}));

export const suppressionRelations = relations(emito_suppression, () => ({}));

export const deadLettersRelations = relations(emito_dead_letters, () => ({}));

export const consentsRelations = relations(emito_consents, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_consents.subscriberId],
		references: [emito_subscribers.id],
	}),
}));

export const erasureLogRelations = relations(emito_erasure_log, () => ({}));

export const listsRelations = relations(emito_lists, ({ one, many }) => ({
	category: one(emito_categories, {
		fields: [emito_lists.categoryId],
		references: [emito_categories.id],
	}),
	members: many(emito_list_members),
	broadcasts: many(emito_broadcasts),
}));

export const listMembersRelations = relations(emito_list_members, ({ one }) => ({
	subscriber: one(emito_subscribers, {
		fields: [emito_list_members.subscriberId],
		references: [emito_subscribers.id],
	}),
	list: one(emito_lists, {
		fields: [emito_list_members.listId],
		references: [emito_lists.id],
	}),
}));

export const alertsRelations = relations(emito_alerts, ({ many }) => ({
	history: many(emito_alert_history),
}));

export const alertHistoryRelations = relations(emito_alert_history, ({ one }) => ({
	alert: one(emito_alerts, {
		fields: [emito_alert_history.alertId],
		references: [emito_alerts.id],
	}),
}));

export const broadcastsRelations = relations(emito_broadcasts, ({ one }) => ({
	list: one(emito_lists, {
		fields: [emito_broadcasts.listId],
		references: [emito_lists.id],
	}),
}));
