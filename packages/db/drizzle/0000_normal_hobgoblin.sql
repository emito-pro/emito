CREATE TABLE "emito_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"legal_class" text NOT NULL,
	"default_policy" text NOT NULL,
	"user_configurable" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "emito_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"category" text NOT NULL,
	"topic_slug" text,
	"consented" boolean NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_dead_letters" (
	"id" text PRIMARY KEY NOT NULL,
	"notification_id" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"event_type" text NOT NULL,
	"channel" text NOT NULL,
	"attempts" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"exhausted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution" text
);
--> statement-breakpoint
CREATE TABLE "emito_erasure_log" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"reason" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provider_cascade" jsonb DEFAULT '{}'::jsonb,
	CONSTRAINT "no_delete_erasure_log" CHECK (true)
);
--> statement-breakpoint
CREATE TABLE "emito_inbox" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"workspace_id" text,
	"event_type" text NOT NULL,
	"category" text NOT NULL,
	"topic_key" text,
	"subject" text,
	"body" text NOT NULL,
	"avatar" text,
	"action_url" text,
	"primary_action_label" text,
	"primary_action_url" text,
	"secondary_action_label" text,
	"secondary_action_url" text,
	"data" jsonb DEFAULT '{}'::jsonb,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"subscriber_id" text,
	"name" text,
	"channel" text NOT NULL,
	"events" text[],
	"config" jsonb NOT NULL,
	"secret_fields" text[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_list_members" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"list_id" text NOT NULL,
	"status" text DEFAULT 'unconfirmed' NOT NULL,
	"source" text,
	"subscribed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_list_members_sub_list_unique" UNIQUE("subscriber_id","list_id")
);
--> statement-breakpoint
CREATE TABLE "emito_lists" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"optin_type" text DEFAULT 'single' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"category_id" text,
	"member_count" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_lists_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "emito_notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"workspace_id" text,
	"event_type" text NOT NULL,
	"category" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"delivery_address" text,
	"provider" text,
	"provider_msg_id" text,
	"error_message" text,
	"error_classification" text,
	"attempts" integer DEFAULT 0,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"clicked_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	CONSTRAINT "emito_notifications_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "emito_preferences" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"workspace_id" text,
	"topic_key" text NOT NULL,
	"channel" text,
	"enabled" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_preferences_sub_ws_topic_channel_unique" UNIQUE("subscriber_id","workspace_id","topic_key","channel")
);
--> statement-breakpoint
CREATE TABLE "emito_push_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"token" text NOT NULL,
	"platform" text NOT NULL,
	"device_name" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "emito_subscribers" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text,
	"phone" text,
	"lang" text DEFAULT 'en',
	"locale" text,
	"timezone" text,
	"globally_unsubscribed" boolean DEFAULT false,
	"globally_unsubscribed_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"erased_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"subscriber_id" text NOT NULL,
	"topic_id" text NOT NULL,
	"channel" text NOT NULL,
	"status" text DEFAULT 'opted_in' NOT NULL,
	"consent_mechanism" text,
	"consent_ip" text,
	"consent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_subscriptions_sub_topic_channel_unique" UNIQUE("subscriber_id","topic_id","channel")
);
--> statement-breakpoint
CREATE TABLE "emito_suppression" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"channel" text NOT NULL,
	"reason" text NOT NULL,
	"provider" text,
	"provider_msg_id" text,
	"consecutive_soft" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "emito_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"category_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"default_subscribed" boolean DEFAULT true,
	"user_configurable" boolean DEFAULT true,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "emito_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0,
	"last_attempt_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"response_status" integer,
	"response_body" text,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_webhook_deliveries_endpoint_event_unique" UNIQUE("endpoint_id","event_id")
);
--> statement-breakpoint
CREATE TABLE "emito_webhook_endpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"url" text NOT NULL,
	"events" text[] NOT NULL,
	"signing_secret" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'active' NOT NULL,
	"consecutive_failures" integer DEFAULT 0,
	"last_delivery_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_workspace_defaults" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"topic_key" text NOT NULL,
	"channel" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_workspace_defaults_ws_topic_channel_unique" UNIQUE("workspace_id","topic_key","channel")
);
--> statement-breakpoint
ALTER TABLE "emito_categories" ADD CONSTRAINT "emito_categories_parent_id_emito_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."emito_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_list_members" ADD CONSTRAINT "emito_list_members_subscriber_id_emito_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."emito_subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_list_members" ADD CONSTRAINT "emito_list_members_list_id_emito_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."emito_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_lists" ADD CONSTRAINT "emito_lists_category_id_emito_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."emito_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_subscriptions" ADD CONSTRAINT "emito_subscriptions_subscriber_id_emito_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."emito_subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_subscriptions" ADD CONSTRAINT "emito_subscriptions_topic_id_emito_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."emito_topics"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_topics" ADD CONSTRAINT "emito_topics_category_id_emito_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."emito_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_webhook_deliveries" ADD CONSTRAINT "emito_webhook_deliveries_endpoint_id_emito_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."emito_webhook_endpoints"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_emito_consent_sub" ON "emito_consents" USING btree ("subscriber_id","category","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_dlq_unresolved" ON "emito_dead_letters" USING btree ("exhausted_at" DESC NULLS LAST) WHERE "emito_dead_letters"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_erl_sub" ON "emito_erasure_log" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "idx_emito_inbox_sub" ON "emito_inbox" USING btree ("subscriber_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_inbox_unread" ON "emito_inbox" USING btree ("subscriber_id","read_at") WHERE "emito_inbox"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_inbox_ws" ON "emito_inbox" USING btree ("subscriber_id","workspace_id","created_at" DESC NULLS LAST) WHERE "emito_inbox"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_lmb_list" ON "emito_list_members" USING btree ("list_id","status") WHERE "emito_list_members"."status" = 'confirmed';--> statement-breakpoint
CREATE INDEX "idx_emito_notif_sub" ON "emito_notifications" USING btree ("subscriber_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_notif_event" ON "emito_notifications" USING btree ("event_type","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_notif_status" ON "emito_notifications" USING btree ("status") WHERE "emito_notifications"."status" NOT IN ('delivered', 'opened', 'clicked');--> statement-breakpoint
CREATE INDEX "idx_emito_notif_ws" ON "emito_notifications" USING btree ("workspace_id","created_at" DESC NULLS LAST) WHERE "emito_notifications"."workspace_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_notif_provider_msg_id" ON "emito_notifications" USING btree ("provider_msg_id") WHERE "emito_notifications"."provider_msg_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_pref_sub" ON "emito_preferences" USING btree ("subscriber_id","workspace_id");--> statement-breakpoint
CREATE INDEX "idx_emito_push_active" ON "emito_push_tokens" USING btree ("subscriber_id") WHERE "emito_push_tokens"."active" = true;--> statement-breakpoint
CREATE INDEX "idx_emito_sub_email" ON "emito_subscribers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_emito_sub_erased" ON "emito_subscribers" USING btree ("erased_at") WHERE "emito_subscribers"."erased_at" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "emito_suppression_address_channel_active" ON "emito_suppression" USING btree ("address","channel") WHERE "emito_suppression"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_sup_lookup" ON "emito_suppression" USING btree ("address","channel");