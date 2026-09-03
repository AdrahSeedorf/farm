-- CreateEnum
CREATE TYPE "ProductionDisposition" AS ENUM ('SALEABLE', 'HELD', 'DISCARDED', 'HOME_USE');

-- CreateTable
CREATE TABLE "ProductionGrade" (
    "id" TEXT NOT NULL,
    "productionTypeProfileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isSaleable" BOOLEAN NOT NULL DEFAULT true,
    "minGrams" INTEGER,
    "maxGrams" INTEGER,
    "baseUomId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionGrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionRecord" (
    "id" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "productionUnitId" TEXT,
    "onDate" DATE NOT NULL,
    "sequence" INTEGER NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "countedBase" DOUBLE PRECISION,
    "countedEntered" DOUBLE PRECISION,
    "countedUomId" TEXT,
    "disposition" "ProductionDisposition" NOT NULL DEFAULT 'SALEABLE',
    "dispositionNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "warnings" JSONB,
    "notes" TEXT,
    "correctsId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionLine" (
    "id" TEXT NOT NULL,
    "productionRecordId" TEXT NOT NULL,
    "productionGradeId" TEXT NOT NULL,
    "quantityBase" DOUBLE PRECISION NOT NULL,
    "enteredQuantity" DOUBLE PRECISION NOT NULL,
    "enteredUomId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductionGrade_productionTypeProfileId_sortOrder_idx" ON "ProductionGrade"("productionTypeProfileId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionGrade_productionTypeProfileId_key_key" ON "ProductionGrade"("productionTypeProfileId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRecord_idempotencyKey_key" ON "ProductionRecord"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRecord_correctsId_key" ON "ProductionRecord"("correctsId");

-- CreateIndex
CREATE INDEX "ProductionRecord_animalGroupId_onDate_idx" ON "ProductionRecord"("animalGroupId", "onDate");

-- CreateIndex
CREATE INDEX "ProductionRecord_productionUnitId_onDate_idx" ON "ProductionRecord"("productionUnitId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionRecord_animalGroupId_onDate_sequence_key" ON "ProductionRecord"("animalGroupId", "onDate", "sequence");

-- CreateIndex
CREATE INDEX "ProductionLine_productionGradeId_idx" ON "ProductionLine"("productionGradeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionLine_productionRecordId_productionGradeId_key" ON "ProductionLine"("productionRecordId", "productionGradeId");

-- AddForeignKey
ALTER TABLE "ProductionGrade" ADD CONSTRAINT "ProductionGrade_productionTypeProfileId_fkey" FOREIGN KEY ("productionTypeProfileId") REFERENCES "ProductionTypeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionGrade" ADD CONSTRAINT "ProductionGrade_baseUomId_fkey" FOREIGN KEY ("baseUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "ProductionUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_countedUomId_fkey" FOREIGN KEY ("countedUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_correctsId_fkey" FOREIGN KEY ("correctsId") REFERENCES "ProductionRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionRecord" ADD CONSTRAINT "ProductionRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_productionRecordId_fkey" FOREIGN KEY ("productionRecordId") REFERENCES "ProductionRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_productionGradeId_fkey" FOREIGN KEY ("productionGradeId") REFERENCES "ProductionGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionLine" ADD CONSTRAINT "ProductionLine_enteredUomId_fkey" FOREIGN KEY ("enteredUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
