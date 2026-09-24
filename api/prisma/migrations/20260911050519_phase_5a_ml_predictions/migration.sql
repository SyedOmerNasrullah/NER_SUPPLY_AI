-- AlterTable
ALTER TABLE "RiskPrediction" ADD COLUMN     "entityType" TEXT NOT NULL DEFAULT 'SEGMENT',
ADD COLUMN     "featureValues" JSONB,
ADD COLUMN     "provenance" TEXT NOT NULL DEFAULT 'DETERMINISTIC_DEMO',
ADD COLUMN     "routeId" TEXT,
ADD COLUMN     "scenario" TEXT,
ADD COLUMN     "shapBaseValue" DOUBLE PRECISION,
ALTER COLUMN "segmentId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "RiskPrediction_entityType_provenance_createdAt_idx" ON "RiskPrediction"("entityType", "provenance", "createdAt");
