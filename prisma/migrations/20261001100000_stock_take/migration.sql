-- CreateTable
CREATE TABLE "StockTake" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "stockLocationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "countedOn" DATE NOT NULL,
    "countedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTakeLine" (
    "id" TEXT NOT NULL,
    "stockTakeId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "countedBase" DOUBLE PRECISION NOT NULL,
    "expectedBase" DOUBLE PRECISION NOT NULL,
    "varianceBase" DOUBLE PRECISION NOT NULL,
    "cause" TEXT,
    "note" TEXT,
    "movementId" TEXT,

    CONSTRAINT "StockTakeLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockTake_organisationId_reference_key" ON "StockTake"("organisationId", "reference");

-- CreateIndex
CREATE INDEX "StockTake_stockLocationId_countedOn_idx" ON "StockTake"("stockLocationId", "countedOn");

-- CreateIndex
CREATE INDEX "StockTake_organisationId_countedOn_idx" ON "StockTake"("organisationId", "countedOn");

-- CreateIndex
CREATE UNIQUE INDEX "StockTakeLine_stockTakeId_itemId_key" ON "StockTakeLine"("stockTakeId", "itemId");

-- CreateIndex
CREATE INDEX "StockTakeLine_itemId_idx" ON "StockTakeLine"("itemId");

-- AddForeignKey
ALTER TABLE "StockTake" ADD CONSTRAINT "StockTake_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTake" ADD CONSTRAINT "StockTake_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTake" ADD CONSTRAINT "StockTake_countedById_fkey" FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTakeLine" ADD CONSTRAINT "StockTakeLine_stockTakeId_fkey" FOREIGN KEY ("stockTakeId") REFERENCES "StockTake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTakeLine" ADD CONSTRAINT "StockTakeLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
