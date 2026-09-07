-- AlterTable
ALTER TABLE "LifecycleStage" ADD COLUMN     "mortalityAttentionPct" DOUBLE PRECISION,
ADD COLUMN     "mortalityCriticalPct" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "mortalityAttentionPct" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
ADD COLUMN     "mortalityCriticalPct" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
ADD COLUMN     "mortalitySpikeFloorDeaths" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "mortalitySpikeMultiple" DOUBLE PRECISION NOT NULL DEFAULT 3,
ADD COLUMN     "recordDueHour" INTEGER NOT NULL DEFAULT 10;
