-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('PREDATOR', 'THEFT', 'EQUIPMENT', 'POWER', 'WEATHER', 'ESCAPE', 'PERSON_HURT', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('MINOR', 'NOTABLE', 'SERIOUS');

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "what" TEXT NOT NULL,
    "kind" "IncidentKind",
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "severity" "IncidentSeverity",
    "reviewNote" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_organisationId_reviewedAt_idx" ON "Incident"("organisationId", "reviewedAt");

-- CreateIndex
CREATE INDEX "Incident_siteId_occurredAt_idx" ON "Incident"("siteId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_organisationId_reference_key" ON "Incident"("organisationId", "reference");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
