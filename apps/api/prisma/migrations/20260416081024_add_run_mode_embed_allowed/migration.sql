-- CreateEnum
CREATE TYPE "RunMode" AS ENUM ('AUTOMATED', 'MANUAL');

-- AlterTable
ALTER TABLE "environments" ADD COLUMN     "embedAllowed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "feature_runs" ADD COLUMN     "runMode" "RunMode" NOT NULL DEFAULT 'AUTOMATED';

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "runMode" "RunMode" NOT NULL DEFAULT 'AUTOMATED';
