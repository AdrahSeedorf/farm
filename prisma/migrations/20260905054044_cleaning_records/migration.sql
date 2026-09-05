-- CreateEnum
CREATE TYPE "CleaningScope" AS ENUM ('PRODUCTION_UNIT', 'STORE', 'EQUIPMENT', 'VEHICLE', 'SITE_AREA');

-- CreateEnum
CREATE TYPE "CleaningStage" AS ENUM ('DRY_CLEAN', 'WASH', 'DISINFECT', 'FUMIGATE', 'REST', 'FULL_TURNAROUND');

-- AlterTable
ALTER TABLE "ProductionUnit" ADD COLUMN     "cleaningIntervalDays" INTEGER;

-- CreateTable
CREATE TABLE "CleaningRecord" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "scope" "CleaningScope" NOT NULL,
    "productionUnitId" TEXT,
    "areaName" TEXT,
    "stage" "CleaningStage" NOT NULL,
    "performedOn" DATE NOT NULL,
    "performedBy" TEXT,
    "itemId" TEXT,
    "quantityBase" DOUBLE PRECISION,
    "dilution" TEXT,
    "contactTimeMinutes" INTEGER,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleaningRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleaningRecord_siteId_performedOn_idx" ON "CleaningRecord"("siteId", "performedOn");

-- CreateIndex
CREATE INDEX "CleaningRecord_productionUnitId_performedOn_idx" ON "CleaningRecord"("productionUnitId", "performedOn");

-- AddForeignKey
ALTER TABLE "CleaningRecord" ADD CONSTRAINT "CleaningRecord_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningRecord" ADD CONSTRAINT "CleaningRecord_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "ProductionUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningRecord" ADD CONSTRAINT "CleaningRecord_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningRecord" ADD CONSTRAINT "CleaningRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
