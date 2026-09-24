"""
Request and response models for the internal prediction API.

Validation bounds are PHYSICAL plausibility, deliberately wider than the training range: 60 mm of
rain in an hour is extreme but real, and rejecting it would be wrong. A value that is physically
possible but outside what the model learned from is accepted and flagged in `warnings` instead —
the caller learns the prediction was an extrapolation, and decides what to do with it.

Negative rainfall, a slope past vertical, or a road condition that is not GOOD/FAIR/POOR is not
an extrapolation; it is a bad request, and it gets a 422.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RoadCondition = Literal["GOOD", "FAIR", "POOR"]
RiskLevel = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class RouteRiskFeatures(BaseModel):
    """The twelve contract features. Every one is required: there is no default for a missing
    rainfall reading, because any default would be a guess presented as data."""

    # Unknown keys are rejected rather than ignored. A caller sending `season` should find out
    # that it is not a feature, not have it silently dropped.
    model_config = ConfigDict(extra="forbid")

    rainfall1h: float = Field(ge=0, le=200, description="mm, last hour")
    rainfall3h: float = Field(ge=0, le=400, description="mm, last 3 hours")
    rainfall6h: float = Field(ge=0, le=600, description="mm, last 6 hours")
    rainfall24h: float = Field(ge=0, le=1000, description="mm, last 24 hours")
    windSpeedKmh: float = Field(ge=0, le=250)
    roadCondition: RoadCondition
    terrainSlopeDeg: float = Field(ge=0, le=90)
    elevationM: float = Field(ge=-100, le=9000)
    historicalLandslides: float = Field(ge=0, le=1000)
    historicalFloods: float = Field(ge=0, le=1000)
    previousClosureFrequencyPct: float = Field(ge=0, le=100)
    trafficLevel: float = Field(ge=0, le=2, description="0 low, 1 medium, 2 high; route inputs may be a mean")


class RouteRiskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    features: RouteRiskFeatures
    #: Optional caller reference ("SEG-010", a route id) echoed back for correlation. Not used
    #: by the model.
    reference: str | None = Field(default=None, max_length=120)


class TopFactor(BaseModel):
    """One SHAP contribution. A superset of the frontend's `RiskFactor {factor, contributionPct}`
    — `factor` and `contributionPct` mean the same thing there — so a stored factor list can be
    shown by the existing UI without translation."""

    factor: str
    feature: str
    value: float | str
    shapValue: float
    #: What `shapValue` is measured in: route risk points, log1p-minutes, or log-odds. Present so
    #: a contribution can never be read as "percent of the prediction".
    shapUnit: str | None = None
    contributionPct: float
    direction: Literal["increases_risk", "decreases_risk"]


class Provenance(BaseModel):
    source: Literal["ML_PREDICTION"] = "ML_PREDICTION"
    modelVersion: str
    modelType: str
    trainedOn: Literal["synthetic"] = "synthetic"
    datasetSha256: str
    artifactSha256: str
    explanationMethod: str


class RouteRiskResponse(BaseModel):
    modelVersion: str
    reference: str | None
    riskScore: int = Field(ge=0, le=100)
    riskProbability: float = Field(ge=0, le=1)
    riskLevel: RiskLevel
    rawPrediction: float
    featureValues: dict[str, float | str]
    encodedFeatures: dict[str, float]
    topFactors: list[TopFactor] = Field(min_length=1)
    shapBaseValue: float
    provenance: Provenance
    warnings: list[str]


class HealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    service: str
    modelVersion: str
    modelLoaded: bool
    deliveryModelVersion: str | None = None
    deliveryModelLoaded: bool = False
    authConfigured: bool
    detail: str | None = None


# ---------------------------------------------------------------------------
# Delivery risk — the second model pair (delay regression + failure classification)
# ---------------------------------------------------------------------------

WeatherSeverity = Literal["NORMAL", "MODERATE", "HEAVY", "SEVERE"]
CargoPriority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]


class DeliveryRiskFeatures(BaseModel):
    """
    The seven contract features. Bounds are physical plausibility, as above: a vehicle 900 km out
    is unusual for this corridor but not impossible, and the response flags the extrapolation
    rather than refusing the request.

    `weatherSeverity` and `cargoPriority` accept either the encoded integer or the name Express
    already holds (`HEAVY`, `CRITICAL`), so neither side has to remember the mapping.
    """

    model_config = ConfigDict(extra="forbid")

    distanceRemainingKm: float = Field(ge=0, le=5000)
    currentSpeedKmh: float = Field(ge=0, le=200)
    routeRiskScore: float = Field(ge=0, le=100)
    weatherSeverity: float | WeatherSeverity = Field(description="0 normal, 1 moderate, 2 heavy, 3 severe")
    cargoPriority: float | CargoPriority = Field(description="0 LOW, 1 MEDIUM, 2 HIGH, 3 CRITICAL")
    hourOfDay: float = Field(ge=0, le=23)
    dayOfWeek: float = Field(ge=0, le=6, description="0 = Monday ... 6 = Sunday")


class DeliveryRiskRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    features: DeliveryRiskFeatures
    reference: str | None = Field(default=None, max_length=120)


class DeliveryRiskResponse(BaseModel):
    modelVersion: str
    reference: str | None
    #: 0-1, calibrated. The Decision Engine compares this against a fixed threshold, so it must
    #: be a probability and not a squashed score.
    failureProbability: float = Field(ge=0, le=1)
    #: Minutes late, capped at the 1440 the models were trained to.
    predictedDelayMinutes: int = Field(ge=0, le=1440)
    #: Before clipping, so a capped prediction is visible rather than silently flattened.
    rawDelayMinutes: float
    featureValues: dict[str, float | str]
    encodedFeatures: dict[str, float]
    #: What drove the failure probability (log-odds), strongest first.
    topFactors: list[TopFactor] = Field(min_length=1)
    #: What drove the predicted delay (log1p-minutes), strongest first.
    delayFactors: list[TopFactor] = Field(min_length=1)
    shapBaseValue: float
    delayShapBaseValue: float
    provenance: Provenance
    warnings: list[str]
