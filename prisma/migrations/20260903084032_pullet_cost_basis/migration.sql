-- CreateEnum
CREATE TYPE "CostAllocationMethod" AS ENUM ('BIRD_DAYS', 'HEADCOUNT', 'EQUAL', 'MANUAL');

-- AlterTable
ALTER TABLE "FlockCostEntry" ADD COLUMN     "allocationId" TEXT,
ADD COLUMN     "allocationWeight" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "LifecycleStage" ADD COLUMN     "isProductionStart" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "pulletMarketPriceOn" DATE,
ADD COLUMN     "pulletMarketPricePesewas" INTEGER,
ADD COLUMN     "pulletMarketPriceSource" TEXT;

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "category" "FlockCostCategory" NOT NULL,
    "amountPesewas" INTEGER NOT NULL,
    "incurredOn" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "method" "CostAllocationMethod" NOT NULL,
    "periodStart" DATE,
    "periodEnd" DATE,
    "reference" TEXT,
    "reversesId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CostAllocation_reversesId_key" ON "CostAllocation"("reversesId");

-- CreateIndex
CREATE INDEX "CostAllocation_organisationId_incurredOn_idx" ON "CostAllocation"("organisationId", "incurredOn");

-- CreateIndex
CREATE INDEX "CostAllocation_organisationId_category_idx" ON "CostAllocation"("organisationId", "category");

-- CreateIndex
CREATE INDEX "FlockCostEntry_allocationId_idx" ON "FlockCostEntry"("allocationId");

-- AddForeignKey
ALTER TABLE "FlockCostEntry" ADD CONSTRAINT "FlockCostEntry_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "CostAllocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "CostAllocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
