CREATE TABLE "document_mirror_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"issue_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"key" text NOT NULL,
	"target_user_id" text NOT NULL,
	"relative_path" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "document_mirror_queue_target_issue_key_uq" ON "document_mirror_queue" USING btree ("target_user_id","issue_id","key");--> statement-breakpoint
CREATE INDEX "document_mirror_queue_target_status_idx" ON "document_mirror_queue" USING btree ("target_user_id","status");