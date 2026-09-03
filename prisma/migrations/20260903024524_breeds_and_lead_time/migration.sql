/*
  Warnings:

  - You are about to drop the column `breed` on the `AnimalGroup` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "AnimalGroup" DROP COLUMN "breed",
ADD COLUMN     "breedId" TEXT;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "stockLeadTimeDays" INTEGER NOT NULL DEFAULT 7;

-- CreateTable
CREATE TABLE "Breed" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "speciesProfileId" TEXT,
    "productionTypeProfileId" TEXT,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "supplier" TEXT,
    "standards" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Breed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Breed_organisationId_isActive_idx" ON "Breed"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Breed_organisationId_key_key" ON "Breed"("organisationId", "key");

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_breedId_fkey" FOREIGN KEY ("breedId") REFERENCES "Breed"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_speciesProfileId_fkey" FOREIGN KEY ("speciesProfileId") REFERENCES "SpeciesProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Breed" ADD CONSTRAINT "Breed_productionTypeProfileId_fkey" FOREIGN KEY ("productionTypeProfileId") REFERENCES "ProductionTypeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
