-- CreateEnum
CREATE TYPE "VisitorKind" AS ENUM ('VETERINARIAN', 'SUPPLIER', 'BUYER', 'CONTRACTOR', 'INSPECTOR', 'STAFF_RETURNING', 'NEIGHBOUR', 'OTHER');

-- CreateEnum
CREATE TYPE "PoultryContactDeclaration" AS ENUM ('NOT_DECLARED', 'NONE', 'AT');

-- AlterTable
ALTER TABLE "Site" ADD COLUMN     "visitorDowntimeHours" INTEGER;

-- CreateTable
CREATE TABLE "VisitorLog" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "organisation" TEXT,
    "phone" TEXT,
    "kind" "VisitorKind" NOT NULL,
    "purpose" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL,
    "departedAt" TIMESTAMP(3),
    "declaration" "PoultryContactDeclaration" NOT NULL DEFAULT 'NOT_DECLARED',
    "lastPoultryContactAt" TIMESTAMP(3),
    "downtimeHoursAtEntry" INTEGER,
    "vehicleRegistration" TEXT,
    "enteredProductionUnit" BOOLEAN NOT NULL DEFAULT false,
    "usedFootbath" BOOLEAN,
    "woreFarmClothing" BOOLEAN,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VisitorLog_siteId_arrivedAt_idx" ON "VisitorLog"("siteId", "arrivedAt");

-- CreateIndex
CREATE INDEX "VisitorLog_siteId_departedAt_idx" ON "VisitorLog"("siteId", "departedAt");

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorLog" ADD CONSTRAINT "VisitorLog_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
