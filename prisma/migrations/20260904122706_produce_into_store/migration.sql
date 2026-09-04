/*
  Warnings:

  - A unique constraint covering the columns `[itemId]` on the table `ProductionGrade` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "shelfLifeDays" INTEGER;

-- AlterTable
ALTER TABLE "ProductionGrade" ADD COLUMN     "itemId" TEXT;

-- AlterTable
ALTER TABLE "StockLocation" ADD COLUMN     "receivesProduction" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ProductionGrade_itemId_key" ON "ProductionGrade"("itemId");

-- AddForeignKey
ALTER TABLE "ProductionGrade" ADD CONSTRAINT "ProductionGrade_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;
