CREATE TYPE "public"."battle_result" AS ENUM('win', 'loss');--> statement-breakpoint
CREATE TYPE "public"."container" AS ENUM('inv', 'stash', 'equipped');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('normal', 'dangerous', 'nightmare');--> statement-breakpoint
CREATE TYPE "public"."equipment_slot" AS ENUM('weapon', 'offhand', 'helmet', 'chest', 'bracers', 'boots', 'amulet', 'ring');--> statement-breakpoint
CREATE TYPE "public"."rarity" AS ENUM('common', 'magic', 'rare', 'epic', 'legendary');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('active', 'extracted', 'wiped');--> statement-breakpoint
CREATE TYPE "public"."zone" AS ENUM('wastes', 'warcamp', 'catacombs', 'forge', 'abyss', 'rift');--> statement-breakpoint
CREATE TABLE "equipment" (
	"player_id" uuid NOT NULL,
	"slot" "equipment_slot" NOT NULL,
	"item_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"container" "container" DEFAULT 'inv' NOT NULL,
	"slot_index" integer,
	"base_key" text NOT NULL,
	"ilvl" integer NOT NULL,
	"rarity" "rarity" NOT NULL,
	"affixes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"upgrade_level" integer DEFAULT 0 NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_ilvl_range" CHECK ("items"."ilvl" between 1 and 200),
	CONSTRAINT "items_upgrade_range" CHECK ("items"."upgrade_level" between 0 and 10),
	CONSTRAINT "items_slot_index_non_negative" CHECK ("items"."slot_index" is null or "items"."slot_index" >= 0)
);
--> statement-breakpoint
CREATE TABLE "player_traits" (
	"player_id" uuid NOT NULL,
	"trait_id" text NOT NULL,
	"slot" integer NOT NULL,
	CONSTRAINT "player_traits_slot_non_negative" CHECK ("player_traits"."slot" >= 0)
);
--> statement-breakpoint
CREATE TABLE "arena_ladder" (
	"season_id" integer NOT NULL,
	"player_id" uuid NOT NULL,
	"elo" integer DEFAULT 1000 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"snapshot" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "arena_ladder_elo_non_negative" CHECK ("arena_ladder"."elo" >= 0),
	CONSTRAINT "arena_ladder_wins_non_negative" CHECK ("arena_ladder"."wins" >= 0),
	CONSTRAINT "arena_ladder_losses_non_negative" CHECK ("arena_ladder"."losses" >= 0)
);
--> statement-breakpoint
CREATE TABLE "battles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"run_id" uuid,
	"opponent_ref" text NOT NULL,
	"seed" text NOT NULL,
	"log" jsonb NOT NULL,
	"result" "battle_result" NOT NULL,
	"rewards" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dailies" (
	"player_id" uuid NOT NULL,
	"day_utc" date NOT NULL,
	"arena_left" integer DEFAULT 5 NOT NULL,
	"quests" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shop_seed" text NOT NULL,
	CONSTRAINT "dailies_arena_left_range" CHECK ("dailies"."arena_left" between 0 and 5)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"zone" "zone" NOT NULL,
	"difficulty" "difficulty" NOT NULL,
	"fight_index" integer DEFAULT 0 NOT NULL,
	"bag" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "run_state" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "runs_fight_index_range" CHECK ("runs"."fight_index" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_traits" ADD CONSTRAINT "player_traits_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arena_ladder" ADD CONSTRAINT "arena_ladder_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "battles" ADD CONSTRAINT "battles_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dailies" ADD CONSTRAINT "dailies_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_player_slot_idx" ON "equipment" USING btree ("player_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_item_idx" ON "equipment" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "items_owner_container_idx" ON "items" USING btree ("owner_id","container");--> statement-breakpoint
CREATE UNIQUE INDEX "player_traits_slot_idx" ON "player_traits" USING btree ("player_id","slot");--> statement-breakpoint
CREATE UNIQUE INDEX "player_traits_unique_idx" ON "player_traits" USING btree ("player_id","trait_id");--> statement-breakpoint
CREATE UNIQUE INDEX "arena_ladder_season_player_idx" ON "arena_ladder" USING btree ("season_id","player_id");--> statement-breakpoint
CREATE INDEX "arena_ladder_season_elo_idx" ON "arena_ladder" USING btree ("season_id","elo");--> statement-breakpoint
CREATE INDEX "battles_player_created_idx" ON "battles" USING btree ("player_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "dailies_player_day_idx" ON "dailies" USING btree ("player_id","day_utc");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_one_active_per_player_idx" ON "runs" USING btree ("player_id") WHERE "runs"."state" = 'active';--> statement-breakpoint
CREATE INDEX "runs_player_idx" ON "runs" USING btree ("player_id");