-- CreateEnum
CREATE TYPE "CheckResult" AS ENUM ('PASS', 'FAIL', 'NOT_CHECKED', 'NOT_APPLICABLE');

-- CreateTable
CREATE TABLE "BiosecurityChecklist" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiosecurityChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiosecurityChecklistItem" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "guidance" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BiosecurityChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiosecurityCheck" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "performedOn" DATE NOT NULL,
    "performedBy" TEXT,
    "notes" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiosecurityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiosecurityCheckLine" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "checklistItemId" TEXT NOT NULL,
    "result" "CheckResult" NOT NULL,
    "note" TEXT,
    "labelAtCheck" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiosecurityCheckLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BiosecurityChecklist_organisationId_name_key" ON "BiosecurityChecklist"("organisationId", "name");

-- CreateIndex
CREATE INDEX "BiosecurityChecklistItem_checklistId_sortOrder_idx" ON "BiosecurityChecklistItem"("checklistId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BiosecurityChecklistItem_checklistId_key_key" ON "BiosecurityChecklistItem"("checklistId", "key");

-- CreateIndex
CREATE INDEX "BiosecurityCheck_siteId_performedOn_idx" ON "BiosecurityCheck"("siteId", "performedOn");

-- CreateIndex
CREATE INDEX "BiosecurityCheckLine_checklistItemId_result_idx" ON "BiosecurityCheckLine"("checklistItemId", "result");

-- CreateIndex
CREATE UNIQUE INDEX "BiosecurityCheckLine_checkId_checklistItemId_key" ON "BiosecurityCheckLine"("checkId", "checklistItemId");

-- AddForeignKey
ALTER TABLE "BiosecurityChecklist" ADD CONSTRAINT "BiosecurityChecklist_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityChecklistItem" ADD CONSTRAINT "BiosecurityChecklistItem_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "BiosecurityChecklist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityCheck" ADD CONSTRAINT "BiosecurityCheck_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityCheck" ADD CONSTRAINT "BiosecurityCheck_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "BiosecurityChecklist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityCheck" ADD CONSTRAINT "BiosecurityCheck_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityCheckLine" ADD CONSTRAINT "BiosecurityCheckLine_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "BiosecurityCheck"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiosecurityCheckLine" ADD CONSTRAINT "BiosecurityCheckLine_checklistItemId_fkey" FOREIGN KEY ("checklistItemId") REFERENCES "BiosecurityChecklistItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
