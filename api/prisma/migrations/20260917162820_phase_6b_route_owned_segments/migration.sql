-- AlterTable
ALTER TABLE "Route" ADD COLUMN     "geometryProvenance" TEXT NOT NULL DEFAULT 'SYNTHETIC_ROUTE_GEOMETRY',
ADD COLUMN     "geometryUpdatedAt" TIMESTAMP(3),
ADD COLUMN     "orsDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "orsDurationMin" INTEGER;

-- AlterTable
ALTER TABLE "RouteSegment" ADD COLUMN     "distanceKm" DOUBLE PRECISION,
ADD COLUMN     "geometry" JSONB,
ADD COLUMN     "geometryProvenance" TEXT NOT NULL DEFAULT 'SYNTHETIC_ROUTE_GEOMETRY',
ADD COLUMN     "routeId" TEXT,
ADD COLUMN     "sequence" INTEGER;

-- CreateIndex
CREATE INDEX "RouteSegment_routeId_sequence_idx" ON "RouteSegment"("routeId", "sequence");
