-- CreateEnum
CREATE TYPE "HealthProgrammeStatus" AS ENUM ('DRAFT', 'APPROVED');

-- AlterTable
ALTER TABLE "HealthProgramme" ADD COLUMN     "approvedByName" TEXT,
ADD COLUMN     "approvedByRole" TEXT,
ADD COLUMN     "approvedOn" DATE,
ADD COLUMN     "status" "HealthProgrammeStatus" NOT NULL DEFAULT 'DRAFT';
