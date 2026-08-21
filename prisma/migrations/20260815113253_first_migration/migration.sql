-- CreateEnum
CREATE TYPE "AnimalGroupEventType" AS ENUM ('PLACEMENT', 'MORTALITY', 'CULL', 'SALE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'STAGE_CHANGE');

-- CreateEnum
CREATE TYPE "FlockCostCategory" AS ENUM ('STOCK_PURCHASE', 'FEED', 'HEALTH', 'LABOUR', 'UTILITIES', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "UomDimension" AS ENUM ('COUNT', 'MASS', 'VOLUME');

-- CreateEnum
CREATE TYPE "ItemCategory" AS ENUM ('FEED', 'VACCINE', 'MEDICINE', 'DISINFECTANT', 'PACKAGING', 'FUEL', 'PPE', 'EQUIPMENT', 'SPARE_PART', 'FINISHED_PRODUCT', 'OTHER');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('PURCHASE_RECEIPT', 'ISSUE', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUSTMENT', 'DAMAGE', 'EXPIRY', 'SALE', 'PRODUCTION', 'CONSUMPTION');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "legalName" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'GHS',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Accra',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "region" TEXT,
    "district" TEXT,
    "town" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionUnit" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpeciesProfile" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "terminology" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeciesProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTypeProfile" (
    "id" TEXT NOT NULL,
    "speciesProfileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capabilities" JSONB NOT NULL,
    "standards" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionTypeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LifecycleStage" (
    "id" TEXT NOT NULL,
    "productionTypeProfileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "typicalStartAgeDays" INTEGER,
    "typicalEndAgeDays" INTEGER,

    CONSTRAINT "LifecycleStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalGroup" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "productionUnitId" TEXT,
    "speciesProfileId" TEXT NOT NULL,
    "productionTypeProfileId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "breed" TEXT,
    "supplierName" TEXT,
    "dateOfHatch" DATE NOT NULL,
    "arrivalDate" DATE,
    "currentStageId" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnimalGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalGroupEvent" (
    "id" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "type" "AnimalGroupEventType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "occurredOn" DATE NOT NULL,
    "ageDays" INTEGER,
    "reasonCode" TEXT,
    "notes" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "toStageId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalGroupEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnimalGroupSnapshot" (
    "id" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "onDate" DATE NOT NULL,
    "openingCount" INTEGER NOT NULL,
    "closingCount" INTEGER NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnimalGroupSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeightSample" (
    "id" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "takenOn" DATE NOT NULL,
    "ageDays" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "weightsGrams" INTEGER[],
    "averageGrams" INTEGER,
    "recordedById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeightSample_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlockCostEntry" (
    "id" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "category" "FlockCostCategory" NOT NULL,
    "amountPesewas" INTEGER NOT NULL,
    "incurredOn" DATE NOT NULL,
    "description" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlockCostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyRecord" (
    "id" TEXT NOT NULL,
    "productionUnitId" TEXT NOT NULL,
    "animalGroupId" TEXT NOT NULL,
    "onDate" DATE NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "observations" TEXT,
    "recordedById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitOfMeasure" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "dimension" "UomDimension" NOT NULL,
    "factorToBase" DOUBLE PRECISION NOT NULL,
    "isBase" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "UnitOfMeasure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ItemCategory" NOT NULL,
    "stockUomId" TEXT NOT NULL,
    "reorderLevel" DOUBLE PRECISION,
    "minimumStock" DOUBLE PRECISION,
    "isPerishable" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemBatch" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiresOn" DATE,
    "unitCostPesewas" INTEGER,
    "receivedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocation" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "itemBatchId" TEXT,
    "stockLocationId" TEXT NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "deltaBase" DOUBLE PRECISION NOT NULL,
    "enteredQuantity" DOUBLE PRECISION NOT NULL,
    "enteredUomId" TEXT NOT NULL,
    "occurredOn" DATE NOT NULL,
    "reasonCode" TEXT,
    "notes" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT,
    "pinHash" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "roleId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserSiteScope" (
    "userId" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,

    CONSTRAINT "UserSiteScope_pkey" PRIMARY KEY ("userId","siteId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Site_organisationId_idx" ON "Site"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_organisationId_code_key" ON "Site"("organisationId", "code");

-- CreateIndex
CREATE INDEX "ProductionUnit_siteId_idx" ON "ProductionUnit"("siteId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionUnit_siteId_code_key" ON "ProductionUnit"("siteId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SpeciesProfile_organisationId_key_key" ON "SpeciesProfile"("organisationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ProductionTypeProfile_speciesProfileId_key_key" ON "ProductionTypeProfile"("speciesProfileId", "key");

-- CreateIndex
CREATE INDEX "LifecycleStage_productionTypeProfileId_sequence_idx" ON "LifecycleStage"("productionTypeProfileId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "LifecycleStage_productionTypeProfileId_key_key" ON "LifecycleStage"("productionTypeProfileId", "key");

-- CreateIndex
CREATE INDEX "AnimalGroup_siteId_closedAt_idx" ON "AnimalGroup"("siteId", "closedAt");

-- CreateIndex
CREATE INDEX "AnimalGroup_productionUnitId_idx" ON "AnimalGroup"("productionUnitId");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalGroup_siteId_code_key" ON "AnimalGroup"("siteId", "code");

-- CreateIndex
CREATE INDEX "AnimalGroupEvent_animalGroupId_occurredOn_idx" ON "AnimalGroupEvent"("animalGroupId", "occurredOn");

-- CreateIndex
CREATE INDEX "AnimalGroupEvent_animalGroupId_type_idx" ON "AnimalGroupEvent"("animalGroupId", "type");

-- CreateIndex
CREATE INDEX "AnimalGroupSnapshot_onDate_idx" ON "AnimalGroupSnapshot"("onDate");

-- CreateIndex
CREATE UNIQUE INDEX "AnimalGroupSnapshot_animalGroupId_onDate_key" ON "AnimalGroupSnapshot"("animalGroupId", "onDate");

-- CreateIndex
CREATE INDEX "WeightSample_animalGroupId_takenOn_idx" ON "WeightSample"("animalGroupId", "takenOn");

-- CreateIndex
CREATE INDEX "FlockCostEntry_animalGroupId_incurredOn_idx" ON "FlockCostEntry"("animalGroupId", "incurredOn");

-- CreateIndex
CREATE INDEX "FlockCostEntry_animalGroupId_category_idx" ON "FlockCostEntry"("animalGroupId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecord_idempotencyKey_key" ON "DailyRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DailyRecord_productionUnitId_onDate_idx" ON "DailyRecord"("productionUnitId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "DailyRecord_animalGroupId_onDate_key" ON "DailyRecord"("animalGroupId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "UnitOfMeasure_key_key" ON "UnitOfMeasure"("key");

-- CreateIndex
CREATE INDEX "UnitOfMeasure_dimension_idx" ON "UnitOfMeasure"("dimension");

-- CreateIndex
CREATE INDEX "Item_organisationId_category_idx" ON "Item"("organisationId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Item_organisationId_sku_key" ON "Item"("organisationId", "sku");

-- CreateIndex
CREATE INDEX "ItemBatch_expiresOn_idx" ON "ItemBatch"("expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "ItemBatch_itemId_batchNumber_key" ON "ItemBatch"("itemId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StockLocation_siteId_code_key" ON "StockLocation"("siteId", "code");

-- CreateIndex
CREATE INDEX "StockMovement_itemId_occurredOn_idx" ON "StockMovement"("itemId", "occurredOn");

-- CreateIndex
CREATE INDEX "StockMovement_stockLocationId_itemId_idx" ON "StockMovement"("stockLocationId", "itemId");

-- CreateIndex
CREATE INDEX "StockMovement_itemBatchId_idx" ON "StockMovement"("itemBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE INDEX "Permission_resource_idx" ON "Permission"("resource");

-- CreateIndex
CREATE INDEX "AuditLog_organisationId_createdAt_idx" ON "AuditLog"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionUnit" ADD CONSTRAINT "ProductionUnit_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeciesProfile" ADD CONSTRAINT "SpeciesProfile_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTypeProfile" ADD CONSTRAINT "ProductionTypeProfile_speciesProfileId_fkey" FOREIGN KEY ("speciesProfileId") REFERENCES "SpeciesProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LifecycleStage" ADD CONSTRAINT "LifecycleStage_productionTypeProfileId_fkey" FOREIGN KEY ("productionTypeProfileId") REFERENCES "ProductionTypeProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "ProductionUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_speciesProfileId_fkey" FOREIGN KEY ("speciesProfileId") REFERENCES "SpeciesProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_productionTypeProfileId_fkey" FOREIGN KEY ("productionTypeProfileId") REFERENCES "ProductionTypeProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroup" ADD CONSTRAINT "AnimalGroup_currentStageId_fkey" FOREIGN KEY ("currentStageId") REFERENCES "LifecycleStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroupEvent" ADD CONSTRAINT "AnimalGroupEvent_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroupEvent" ADD CONSTRAINT "AnimalGroupEvent_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroupEvent" ADD CONSTRAINT "AnimalGroupEvent_toStageId_fkey" FOREIGN KEY ("toStageId") REFERENCES "LifecycleStage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnimalGroupSnapshot" ADD CONSTRAINT "AnimalGroupSnapshot_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightSample" ADD CONSTRAINT "WeightSample_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeightSample" ADD CONSTRAINT "WeightSample_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlockCostEntry" ADD CONSTRAINT "FlockCostEntry_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlockCostEntry" ADD CONSTRAINT "FlockCostEntry_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_productionUnitId_fkey" FOREIGN KEY ("productionUnitId") REFERENCES "ProductionUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_animalGroupId_fkey" FOREIGN KEY ("animalGroupId") REFERENCES "AnimalGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyRecord" ADD CONSTRAINT "DailyRecord_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Item" ADD CONSTRAINT "Item_stockUomId_fkey" FOREIGN KEY ("stockUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemBatch" ADD CONSTRAINT "ItemBatch_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLocation" ADD CONSTRAINT "StockLocation_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_itemBatchId_fkey" FOREIGN KEY ("itemBatchId") REFERENCES "ItemBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_stockLocationId_fkey" FOREIGN KEY ("stockLocationId") REFERENCES "StockLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_enteredUomId_fkey" FOREIGN KEY ("enteredUomId") REFERENCES "UnitOfMeasure"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteScope" ADD CONSTRAINT "UserSiteScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSiteScope" ADD CONSTRAINT "UserSiteScope_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
