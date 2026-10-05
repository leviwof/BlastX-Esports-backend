ALTER TABLE "users"
    ADD COLUMN "is_vip" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "crown_badge_unlocked" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "banners"
    ADD COLUMN "tagline" TEXT,
    ADD COLUMN "subtitle" TEXT,
    ADD COLUMN "brand_badge" TEXT,
    ADD COLUMN "button_text" TEXT,
    ADD COLUMN "target_tab_index" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "live_streams" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subtitle" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "viewer_count" TEXT NOT NULL DEFAULT '0',
    "is_live" BOOLEAN NOT NULL DEFAULT false,
    "is_official" BOOLEAN NOT NULL DEFAULT false,
    "image_url" TEXT NOT NULL,
    "stream_url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_streams_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_inquiries" (
    "id" TEXT NOT NULL,
    "brand_name" TEXT NOT NULL,
    "contact_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "partnership_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_inquiries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_inquiries_created_at_idx" ON "partner_inquiries"("created_at");
