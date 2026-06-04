-- Pivot user_workspaces from "exactly one folder per user" to "N folders per user".
-- The per-user unique constraint goes away; we replace it with uniqueness on the
-- (user_id, workspace_path) pair so the same folder can't be granted twice but
-- a user can grant additional, distinct folders.
--
-- Written by hand (not drizzle-kit generate) to avoid the unrelated-drift problem
-- documented in the 0085 migration header.

DROP INDEX IF EXISTS "user_workspaces_user_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_workspaces_user_path_uq" ON "user_workspaces" USING btree ("user_id", "workspace_path");
