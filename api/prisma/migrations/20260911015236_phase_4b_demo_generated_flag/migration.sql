-- AlterTable
ALTER TABLE "AIRecommendation" ADD COLUMN     "demoGenerated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Alert" ADD COLUMN     "demoGenerated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Incident" ADD COLUMN     "demoGenerated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "demoGenerated" BOOLEAN NOT NULL DEFAULT false;
