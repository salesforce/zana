CREATE TABLE IF NOT EXISTS "extensions" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"created_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "publish_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"created_at" integer NOT NULL,
	"last_used_at" integer,
	"revoked_at" integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "releases" (
	"extension_id" text NOT NULL,
	"version" text NOT NULL,
	"zcc_api" text NOT NULL,
	"sha256" text NOT NULL,
	"signature" text NOT NULL,
	"permissions" text,
	"title" text,
	"description" text,
	"author" text,
	"icon" text,
	"archive_bytes" "bytea" NOT NULL,
	"archive_size" integer NOT NULL,
	"published_by" text NOT NULL,
	"created_at" integer NOT NULL,
	CONSTRAINT "releases_extension_id_version_pk" PRIMARY KEY("extension_id","version")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" integer NOT NULL,
	"expires_at" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" text PRIMARY KEY NOT NULL,
	"github_id" integer NOT NULL,
	"github_login" text NOT NULL,
	"avatar_url" text,
	"created_at" integer NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
