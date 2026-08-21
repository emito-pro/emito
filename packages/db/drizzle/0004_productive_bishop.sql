CREATE INDEX "idx_emito_cat_parent" ON "emito_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_emito_lst_category" ON "emito_lists" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "idx_emito_subc_topic" ON "emito_subscriptions" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_emito_top_category" ON "emito_topics" USING btree ("category_id");