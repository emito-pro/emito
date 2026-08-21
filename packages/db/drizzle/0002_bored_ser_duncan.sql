CREATE TABLE "emito_alert_history" (
	"id" text PRIMARY KEY NOT NULL,
	"alert_id" text NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"triggered_value" numeric,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by_user_id" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "emito_alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"metric" text NOT NULL,
	"condition" jsonb NOT NULL,
	"severity" text NOT NULL,
	"notify" jsonb NOT NULL,
	"escalation" jsonb,
	"maintenance" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scope" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "emito_audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"severity" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"request_id" text NOT NULL,
	"ip" text NOT NULL,
	"user_agent" text,
	"api_key_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "no_delete_audit_log" CHECK (true)
);
--> statement-breakpoint
CREATE TABLE "emito_broadcasts" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"list_id" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"bounced_count" integer DEFAULT 0 NOT NULL,
	"opened_count" integer DEFAULT 0 NOT NULL,
	"clicked_count" integer DEFAULT 0 NOT NULL,
	"unsubscribed_count" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_saved_views" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"page" text NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scope" text DEFAULT 'private' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_saved_views_user_name_page_unique" UNIQUE("created_by_user_id","name","page")
);
--> statement-breakpoint
CREATE TABLE "emito_scheduled_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"event_key" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recipients" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by_user_id" text NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emito_template_overrides" (
	"id" text PRIMARY KEY NOT NULL,
	"event_key" text NOT NULL,
	"channel" text NOT NULL,
	"locale" text NOT NULL,
	"source" text NOT NULL,
	"compiled_warning" text,
	"version" integer NOT NULL,
	"created_by_user_id" text NOT NULL,
	"updated_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emito_template_overrides_event_channel_locale_version_unique" UNIQUE("event_key","channel","locale","version")
);
--> statement-breakpoint
ALTER TABLE "emito_lists" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "emito_alert_history" ADD CONSTRAINT "emito_alert_history_alert_id_emito_alerts_id_fk" FOREIGN KEY ("alert_id") REFERENCES "public"."emito_alerts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emito_broadcasts" ADD CONSTRAINT "emito_broadcasts_list_id_emito_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."emito_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_emito_ahi_triggered" ON "emito_alert_history" USING btree ("triggered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_ahi_alert" ON "emito_alert_history" USING btree ("alert_id","triggered_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_alr_enabled_metric" ON "emito_alerts" USING btree ("enabled","metric") WHERE "emito_alerts"."enabled" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "emito_api_keys_active_prefix_unique" ON "emito_api_keys" USING btree ("key_prefix") WHERE "emito_api_keys"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_emito_apk_prefix" ON "emito_api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "idx_emito_aud_created" ON "emito_audit_log" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_aud_actor" ON "emito_audit_log" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_aud_resource" ON "emito_audit_log" USING btree ("resource_type","resource_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_aud_high_severity" ON "emito_audit_log" USING btree ("severity") WHERE "emito_audit_log"."severity" = 'high';--> statement-breakpoint
CREATE INDEX "idx_emito_brc_created" ON "emito_broadcasts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_brc_list" ON "emito_broadcasts" USING btree ("list_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_brc_status_due" ON "emito_broadcasts" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_emito_sch_status_due" ON "emito_scheduled_sends" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "idx_emito_sch_scheduled" ON "emito_scheduled_sends" USING btree ("scheduled_for" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_emito_sch_pending_due" ON "emito_scheduled_sends" USING btree ("scheduled_for") WHERE "emito_scheduled_sends"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_emito_tmo_lookup" ON "emito_template_overrides" USING btree ("event_key","channel","locale","version" DESC NULLS LAST);