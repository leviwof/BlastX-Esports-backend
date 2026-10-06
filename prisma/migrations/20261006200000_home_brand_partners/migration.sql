ALTER TABLE "live_streams"
ADD COLUMN "cta_text" TEXT NOT NULL DEFAULT 'Watch Now →';

CREATE TABLE "brand_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo_url" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_partners_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "brand_partners_is_active_sort_order_idx"
ON "brand_partners"("is_active", "sort_order");
