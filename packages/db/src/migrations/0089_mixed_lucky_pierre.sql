DROP INDEX "user_workspaces_user_path_uq";--> statement-breakpoint
ALTER TABLE "user_workspaces" ADD COLUMN "company_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_workspaces_company_path_uq" ON "user_workspaces" USING btree ("company_id","workspace_path");