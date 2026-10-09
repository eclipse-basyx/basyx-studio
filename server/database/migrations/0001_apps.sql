CREATE TABLE "app_blobs" (
	"digest" text PRIMARY KEY NOT NULL,
	"size" integer NOT NULL,
	"content" "bytea" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_files" (
	"installation_id" text NOT NULL,
	"path" text NOT NULL,
	"digest" text NOT NULL,
	"content_type" text NOT NULL,
	CONSTRAINT "app_files_installation_id_path_pk" PRIMARY KEY("installation_id","path")
);
--> statement-breakpoint
CREATE TABLE "app_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"version" text NOT NULL,
	"digest" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"unsigned" boolean NOT NULL,
	"installed_by" text NOT NULL,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "app_installation_id" text;--> statement-breakpoint
ALTER TABLE "app_files" ADD CONSTRAINT "app_files_installation_id_app_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_files" ADD CONSTRAINT "app_files_digest_app_blobs_digest_fk" FOREIGN KEY ("digest") REFERENCES "public"."app_blobs"("digest") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_files_digest_idx" ON "app_files" USING btree ("digest");--> statement-breakpoint
CREATE UNIQUE INDEX "app_installations_app_id_idx" ON "app_installations" USING btree ("app_id");