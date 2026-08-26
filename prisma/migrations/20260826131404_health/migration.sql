-- CreateEnum
CREATE TYPE "HealthEventType" AS ENUM ('VACCINATION', 'MEDICATION', 'SUPPLEMENT', 'TREATMENT', 'VET_VISIT', 'DIAGNOSIS', 'POST_MORTEM', 'OTHER');

-- CreateEnum
CREATE TYPE "AdministrationRoute" AS ENUM ('DRINKING_WATER', 'EYE_DROP', 'NASAL_DROP', 'SPRAY', 'WING_WEB', 'INJECTION_SUBCUTANEOUS', 'INJECTION_INTRAMUSCULAR', 'IN_FEED', 'TOPICAL', 'ORAL', 'OTHER');

-- AlterTable
ALTER TABLE "AnimalGroup" ADD COLUMN     "healthProgrammeId" TEXT;

-- AlterTable
ALTER TABLE "DailyRecord" ADD COLUMN     "broodTempC" DOUBLE PRECISION,
ADD COLUMN     "chickBehaviour" TEXT,
ADD COLUMN     "feedKg" DOUBLE PRECISION,
ADD COLUMN     "litterCondition" TEXT,
ADD COLUMN     "warnings" JSONB,
ADD COLUMN     "waterLitres" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "HealthProgramme" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "speciesProfileId" TEXT,
    "productionTypeProfileId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceName" TEXT,
    "sourceRole" TEXT,
    "reviewedOn" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthProgrammeItem" (
    "id" TEXT NOT NULL,
    "healthProgrammeId" TEXT NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "windowDays" INTEGER NOT NULL DEFAULT 2,
    "name" TEXT NOT NULL,
    "eventType" "HealthEventType" NOT NULL DEFAULT 'VACCINATION',
    "route" "AdministrationRoute",
    "itemId" TEXT,
    "dosePerBird" DOUBLE PRECISION,
    "eggWithdrawalDays" INTEGER,
    "meatWithdrawalDays" INTEGER,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HealthProgrammeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HealthEvent" (
    "id" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "programmeItemId" TEXT,
    "type" "HealthEventType" NOT NULL,
    "name" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "route" "AdministrationRoute",
    "birdsTreated" INTEGER,
    "itemId" TEXT,
    "itemBatchId" TEXT,
    "quantityBase" DOUBLE PRECISION,
    "costPesewas" INTEGER,
    "eggWithdrawalDays" INTEGER,
    "meatWithdrawalDays" INTEGER,
    "administeredBy" TEXT,
    "vetName" TEXT,
    "diagnosis" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HealthEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HealthProgramme_organisationId_isActive_idx" ON "HealthProgramme"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "HealthProgramme_organisationId_name_key" ON "HealthProgramme"("organisationId", "name");

-- CreateIndex
CREATE INDEX "HealthProgrammeItem_healthProgrammeId_ageDays_idx" ON "HealthProgrammeItem"("healthProgrammeId", "ageDays");

-- CreateIndex
CREATE INDEX "HealthEvent_animalGroupId_occurredOn_idx" ON "HealthEvent"("animalGroupId", "occurredOn");

-- CreateIndex
CREATE INDEX "HealthEvent_programmeItemId_idx" ON "HealthEvent"("programmeItemId");

-- CreateIndex
CREATE INDEX "HealthEvent_animalGroupId_type_idx" ON "HealthEvent"("animalGroupId", "type");

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_healthProgrammeId_fkey" FOREIGN KEY ("healthProgrammeId") REFERENCES "HealthProgramme"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthProgramme" ADD CONSTRAINT "HealthProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthProgramme" ADD CONSTRAINT "HealthProgramme_speciesProfileId_fkey" FOREIGN KEY ("speciesProfileId") REFERENCES "SpeciesProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthProgramme" ADD CONSTRAINT "HealthProgramme_productionTypeProfileId_fkey" FOREIGN KEY ("productionTypeProfileId") REFERENCES "ProductionTypeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthProgrammeItem" ADD CONSTRAINT "HealthProgrammeItem_healthProgrammeId_fkey" FOREIGN KEY ("healthProgrammeId") REFERENCES "HealthProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthProgrammeItem" ADD CONSTRAINT "HealthProgrammeItem_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_programmeItemId_fkey" FOREIGN KEY ("programmeItemId") REFERENCES "HealthProgrammeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_itemBatchId_fkey" FOREIGN KEY ("itemBatchId") REFERENCES "ItemBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HealthEvent" ADD CONSTRAINT "HealthEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
