-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'LOGISTICS_OFFICER', 'FIELD_OFFICER', 'DISTRICT_OFFICER');

-- CreateEnum
CREATE TYPE "CargoPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'IN_TRANSIT', 'AT_RISK', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "RoadCondition" AS ENUM ('GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "SegmentStatus" AS ENUM ('OPEN', 'PARTIAL', 'BLOCKED');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('LANDSLIDE', 'FLOOD', 'DEBRIS', 'DAMAGED_ROAD', 'BLOCKED_ROAD', 'NORMAL');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('REROUTE', 'PRE_POSITION', 'ALERT', 'NONE');

-- CreateEnum
CREATE TYPE "BlockageLevel" AS ENUM ('NONE', 'PARTIAL', 'SEVERE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "phone" TEXT,
    "districtId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "currentStock" INTEGER NOT NULL,
    "dailyConsumption" DOUBLE PRECISION NOT NULL,
    "predictedStockoutHours" DOUBLE PRECISION,
    "lastRestockedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockoutEvent" (
    "id" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "hoursAtEvent" DOUBLE PRECISION NOT NULL,
    "triggeredBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "driverPhone" TEXT,
    "currentLat" DOUBLE PRECISION NOT NULL,
    "currentLng" DOUBLE PRECISION NOT NULL,
    "speedKmh" DOUBLE PRECISION NOT NULL,
    "expectedSpeedKmh" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "nearestPlace" TEXT,
    "currentDeliveryId" TEXT,
    "currentRouteId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteSegment" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startLat" DOUBLE PRECISION NOT NULL,
    "startLng" DOUBLE PRECISION NOT NULL,
    "endLat" DOUBLE PRECISION NOT NULL,
    "endLng" DOUBLE PRECISION NOT NULL,
    "terrainSlopeDeg" DOUBLE PRECISION NOT NULL,
    "elevationM" DOUBLE PRECISION NOT NULL,
    "roadCondition" "RoadCondition" NOT NULL,
    "roadType" TEXT NOT NULL,
    "distanceToRiverKm" DOUBLE PRECISION NOT NULL,
    "historicalLandslides" INTEGER NOT NULL,
    "historicalFloods" INTEGER NOT NULL,
    "previousClosureFrequencyPct" DOUBLE PRECISION NOT NULL,
    "trafficLevel" INTEGER NOT NULL,
    "currentStatus" "SegmentStatus" NOT NULL DEFAULT 'OPEN',
    "lastRiskScore" INTEGER,
    "lastRiskFactors" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteSegment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Route" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "etaMinutes" INTEGER NOT NULL,
    "geometry" JSONB NOT NULL,
    "segmentIds" TEXT[],
    "riskScore" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "isRecommended" BOOLEAN NOT NULL DEFAULT false,
    "topFactors" JSONB,
    "explanationText" TEXT,
    "profile" JSONB,
    "elevationProfile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Route_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "cargoType" TEXT NOT NULL,
    "priority" "CargoPriority" NOT NULL,
    "originLat" DOUBLE PRECISION NOT NULL,
    "originLng" DOUBLE PRECISION NOT NULL,
    "destLat" DOUBLE PRECISION NOT NULL,
    "destLng" DOUBLE PRECISION NOT NULL,
    "originName" TEXT,
    "destName" TEXT,
    "cargoUnits" INTEGER,
    "destDistrictId" TEXT,
    "assignedVehicleId" TEXT,
    "assignedRouteId" TEXT,
    "requiredEta" TIMESTAMP(3) NOT NULL,
    "currentEta" TIMESTAMP(3) NOT NULL,
    "failureProbability" DOUBLE PRECISION,
    "expectedDelayMinutes" INTEGER,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "segmentId" TEXT,
    "type" "IncidentType" NOT NULL,
    "severity" "Severity" NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "cvDetectedClass" TEXT,
    "cvConfidence" DOUBLE PRECISION,
    "cvEstimatedBlockage" "BlockageLevel",
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskPrediction" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "riskProbability" DOUBLE PRECISION NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "predictedDisruption" BOOLEAN NOT NULL,
    "topFactors" JSONB NOT NULL,
    "explanationText" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RiskPrediction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIRecommendation" (
    "id" TEXT NOT NULL,
    "type" "RecommendationType" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "recommendationText" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "notifiedViaTwilio" BOOLEAN NOT NULL DEFAULT false,
    "twilioSid" TEXT,
    "smsStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
    "callStatus" TEXT NOT NULL DEFAULT 'NOT_ATTEMPTED',
    "twilioCallSid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherSnapshot" (
    "id" TEXT NOT NULL,
    "segmentId" TEXT NOT NULL,
    "rainfall1h" DOUBLE PRECISION NOT NULL,
    "rainfall3h" DOUBLE PRECISION NOT NULL,
    "rainfall6h" DOUBLE PRECISION NOT NULL,
    "rainfall24h" DOUBLE PRECISION NOT NULL,
    "windSpeedKmh" DOUBLE PRECISION NOT NULL,
    "visibility" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VehicleMovement" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "vehicleCode" TEXT NOT NULL,
    "deliveryId" TEXT,
    "deliveryCode" TEXT NOT NULL,
    "place" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "delayMinutes" INTEGER,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VehicleMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "alertTitle" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientRole" "Role" NOT NULL,
    "recipientPhone" TEXT,
    "failureReason" TEXT,
    "relatedId" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPerformance" (
    "date" DATE NOT NULL,
    "successRatePct" DOUBLE PRECISION NOT NULL,
    "avgDelayMin" INTEGER NOT NULL,
    "deliveriesTotal" INTEGER NOT NULL,
    "deliveriesLate" INTEGER NOT NULL,

    CONSTRAINT "DailyPerformance_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "DemoState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "seededAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seedVersion" TEXT NOT NULL,

    CONSTRAINT "DemoState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_code_key" ON "Vehicle"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RouteSegment_code_key" ON "RouteSegment"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_code_key" ON "Delivery"("code");

-- CreateIndex
CREATE INDEX "VehicleMovement_createdAt_idx" ON "VehicleMovement"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_sentAt_idx" ON "Notification"("sentAt");
