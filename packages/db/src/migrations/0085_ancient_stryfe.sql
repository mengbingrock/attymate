-- Adds user_workspaces table for the AttyMate "grant local folder" feature.
-- One row per user; the workspace_path is the absolute path the user picked
-- via Electron's native folder dialog. The agent runtime scopes
-- local_read_file calls to this path (no traversal outside).
--
-- (NB: this migration was scaffolded by `drizzle-kit generate` which also
-- picked up unrelated schema drift since the 0081 snapshot. The drift covers
-- tables already created by prior migrations 0082–0084, so re-emitting their
-- CREATEs would fail on existing deployments. Only the user_workspaces
-- statements are kept here; the snapshot file is left intact so a future
-- `db:generate` cycle has a clean diff baseline.)

CREATE TABLE "user_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"workspace_path" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "user_workspaces_user_uq" ON "user_workspaces" USING btree ("user_id");
