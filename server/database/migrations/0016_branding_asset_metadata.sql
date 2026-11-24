ALTER TABLE "branding_assets" ADD COLUMN "url" text;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "version" text GENERATED ALWAYS AS (left(encode(sha256(content), 'hex'), 12)) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "branding_assets" ADD COLUMN "size" integer GENERATED ALWAYS AS (octet_length(content)) STORED NOT NULL;
--> statement-breakpoint
UPDATE "branding_assets" SET "url" = convert_from("content", 'UTF8') WHERE "content_type" = 'text/uri-list';
