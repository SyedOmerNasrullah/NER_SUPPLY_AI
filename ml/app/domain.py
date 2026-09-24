"""
The route-risk feature contract — the one place the Python side defines it.

Training and inference both import from here, so the model can never be trained on one encoding
and asked to predict on another. That mismatch is silent: XGBoost does not know what column 5
means, and a model fed GOOD=2 instead of GOOD=0 returns a confident, wrong number.

What is deliberately NOT here: the label formula. It lives in `training/label_formula.py` and
nothing under `app/` may import it (a test enforces this). If inference could reach the formula,
the cheapest way to "predict" would be to compute the label directly — which is fake ML with
extra steps.
"""

from __future__ import annotations

from typing import Final

# ---------------------------------------------------------------------------
# Features — contract section 5, in the exact column order the model was trained on
# ---------------------------------------------------------------------------

#: `season` is deliberately absent: the contract review dropped it and it must not return.
#: `distanceToRiverKm` and `roadType` exist on RouteSegment but are not model inputs.
FEATURE_ORDER: Final[tuple[str, ...]] = (
    "rainfall1h",
    "rainfall3h",
    "rainfall6h",
    "rainfall24h",
    "windSpeedKmh",
    "roadCondition",
    "terrainSlopeDeg",
    "elevationM",
    "historicalLandslides",
    "historicalFloods",
    "previousClosureFrequencyPct",
    "trafficLevel",
)

#: Contract section 6.1, identical in training and inference. Matches the Prisma
#: `RoadCondition` enum, which is what Express sends.
ROAD_CONDITION_CODE: Final[dict[str, int]] = {"GOOD": 0, "FAIR": 1, "POOR": 2}

#: trafficLevel follows PROJECT_CONTRACT §1 (`RouteSegment.trafficLevel`): 0 = low, 1 = medium,
#: 2 = high. Segment inputs are those integers. Route-level inputs are the MEAN over the covered
#: segments, so they land between the integers — which is why the model is trained on the
#: continuous range [0, 2] rather than only on {0, 1, 2}.
TRAFFIC_LEVEL_RANGE: Final[tuple[float, float]] = (0.0, 2.0)

#: The range each feature was sampled over in training. Inputs outside it are still scored —
#: a tree model simply holds its last value beyond the edge of what it has seen — but the
#: response says so, because a prediction made by extrapolation deserves less trust.
TRAINING_RANGE: Final[dict[str, tuple[float, float]]] = {
    "rainfall1h": (0.0, 25.0),
    "rainfall3h": (0.0, 60.0),
    "rainfall6h": (0.0, 95.0),
    "rainfall24h": (0.0, 150.0),
    "windSpeedKmh": (0.0, 70.0),
    "roadCondition": (0.0, 2.0),
    "terrainSlopeDeg": (0.0, 40.0),
    "elevationM": (0.0, 4200.0),
    "historicalLandslides": (0.0, 15.0),
    "historicalFloods": (0.0, 12.0),
    "previousClosureFrequencyPct": (0.0, 45.0),
    "trafficLevel": TRAFFIC_LEVEL_RANGE,
}

#: Human labels for SHAP factors. Per feature, not per group: SHAP attributes to the columns
#: the model actually split on, and aggregating them afterwards would present a derived number
#: as if the model had produced it.
FEATURE_LABEL: Final[dict[str, str]] = {
    "rainfall1h": "Rainfall (1h)",
    "rainfall3h": "Rainfall (3h)",
    "rainfall6h": "Rainfall (6h)",
    "rainfall24h": "Rainfall (24h)",
    "windSpeedKmh": "Wind Speed",
    "roadCondition": "Road Condition",
    "terrainSlopeDeg": "Terrain Slope",
    "elevationM": "Elevation",
    "historicalLandslides": "Historical Landslides",
    "historicalFloods": "Historical Floods",
    "previousClosureFrequencyPct": "Closure Frequency",
    "trafficLevel": "Traffic",
}

# ---------------------------------------------------------------------------
# Risk bands — PROJECT_CONTRACT §2
# ---------------------------------------------------------------------------

#: Mirrors `riskLevelForScore` in web/src/domain/thresholds.ts. Two languages cannot share one
#: constant, so `tests/test_contract.py` reads the TypeScript file and fails if they diverge.
RISK_BANDS: Final[tuple[tuple[int, str], ...]] = (
    (85, "CRITICAL"),
    (70, "HIGH"),
    (40, "MEDIUM"),
)


def risk_level(score: int) -> str:
    for floor, level in RISK_BANDS:
        if score >= floor:
            return level
    return "LOW"


def encode(features: dict[str, float | str]) -> list[float]:
    """Raw request values -> the numeric row the model expects, in FEATURE_ORDER."""
    row: list[float] = []
    for name in FEATURE_ORDER:
        value = features[name]
        if name == "roadCondition":
            row.append(float(ROAD_CONDITION_CODE[str(value)]))
        else:
            row.append(float(value))
    return row


def out_of_training_range(features: dict[str, float | str]) -> list[str]:
    """Feature names whose value falls outside what the model was trained on."""
    flagged: list[str] = []
    for name, value in zip(FEATURE_ORDER, encode(features)):
        low, high = TRAINING_RANGE[name]
        if value < low or value > high:
            flagged.append(name)
    return flagged
