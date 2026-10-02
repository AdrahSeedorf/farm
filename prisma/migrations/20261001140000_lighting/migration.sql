-- CreateTable
CREATE TABLE "LightingProgramme" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "productionTypeProfileId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "supplementMode" TEXT NOT NULL DEFAULT 'MORNING',
    "sourceNote" TEXT,
    "isDraft" BOOLEAN NOT NULL DEFAULT true,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LightingProgramme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LightingStep" (
    "id" TEXT NOT NULL,
    "programmeId" TEXT NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "totalHours" DOUBLE PRECISION NOT NULL,
    "lux" INTEGER,
    "note" TEXT,

    CONSTRAINT "LightingStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LightingProgramme_organisationId_name_key" ON "LightingProgramme"("organisationId", "name");

-- CreateIndex
CREATE INDEX "LightingProgramme_organisationId_isActive_idx" ON "LightingProgramme"("organisationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "LightingStep_programmeId_ageDays_key" ON "LightingStep"("programmeId", "ageDays");

-- CreateIndex
CREATE INDEX "LightingStep_programmeId_ageDays_idx" ON "LightingStep"("programmeId", "ageDays");

-- AddForeignKey
ALTER TABLE "LightingProgramme" ADD CONSTRAINT "LightingProgramme_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightingProgramme" ADD CONSTRAINT "LightingProgramme_productionTypeProfileId_fkey" FOREIGN KEY ("productionTypeProfileId") REFERENCES "ProductionTypeProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LightingStep" ADD CONSTRAINT "LightingStep_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "LightingProgramme"("id") ON DELETE CASCADE ON UPDATE CASCADE;
