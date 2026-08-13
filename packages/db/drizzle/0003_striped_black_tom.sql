ALTER TABLE "runs" ADD COLUMN "cost_quota_tokens" bigint;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "tokens_used" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "idle_timeout_minutes" integer;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "gate_entered_at" timestamp with time zone;