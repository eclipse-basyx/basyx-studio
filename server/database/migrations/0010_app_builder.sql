CREATE TABLE "app_builder_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"session_id" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_builder_events" (
	"conversation_id" text NOT NULL,
	"seq" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"event" jsonb NOT NULL,
	CONSTRAINT "app_builder_events_conversation_id_seq_pk" PRIMARY KEY("conversation_id","seq")
);
--> statement-breakpoint
CREATE TABLE "app_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"app_id" text NOT NULL,
	"folder" text NOT NULL,
	"origin" text NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_projects_folder_unique" UNIQUE("folder")
);
--> statement-breakpoint
ALTER TABLE "app_builder_conversations" ADD CONSTRAINT "app_builder_conversations_project_id_app_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."app_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_builder_events" ADD CONSTRAINT "app_builder_events_conversation_id_app_builder_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."app_builder_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_builder_conversations_project" ON "app_builder_conversations" USING btree ("project_id");