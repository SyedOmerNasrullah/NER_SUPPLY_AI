"""
The delivery-risk feature contract — the one place the Python side defines it.

Separate from `domain.py` (route risk) on purpose: two models, two contracts, and no shared
column order to reuse by accident. Training and inference both import from here, so a model
cannot be trained on one encoding and then asked to predict on another.

As with route risk, the label formula is NOT here. It lives in
`training/delivery_label_formula.py`, and nothing under `app/` may import it — a test enforces
that. If inference could reach the formula it could compute the answer instead of predicting it.
"""

from __future__ import annotations

from typing import Final

#: Contract order. Both boosters are trained on exactly this column order.
FEATURE_ORDER: Final[tuple[str, ...]] = (
    "distanceRemainingKm",
    "currentSpeedKmh",
    "routeRiskScore",
    "weatherSeverity",
    "cargoPriority",
    "hourOfDay",
    "dayOfWeek",
)

#: 0 normal, 1 moderate, 2 heavy, 3 severe. Express maps its WeatherSnapshot onto these.
WEATHER_SEVERITY_CODE: Final[dict[str, int]] = {
    "NORMAL": 0,
    "MODERATE": 1,
    "HEAVY": 2,
    "SEVERE": 3,
}

#: Matches the Prisma `CargoPriority` enum, which is what Express sends.
CARGO_PRIORITY_CODE: Final[dict[str, int]] = {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}

TRAINING_RANGE: Final[dict[str, tuple[float, float]]] = {
    "distanceRemainingKm": (0.0, 600.0),
    "currentSpeedKmh": (0.0, 80.0),
    "routeRiskScore": (0.0, 100.0),
    "weatherSeverity": (0.0, 3.0),
    "cargoPriority": (0.0, 3.0),
    "hourOfDay": (0.0, 23.0),
    "dayOfWeek": (0.0, 6.0),
}

FEATURE_LABEL: Final[dict[str, str]] = {
    "distanceRemainingKm": "Distance Remaining",
    "currentSpeedKmh": "Current Speed",
    "routeRiskScore": "Route Risk",
    "weatherSeverity": "Weather Severity",
    "cargoPriority": "Cargo Priority",
    "hourOfDay": "Hour of Day",
    "dayOfWeek": "Day of Week",
}


def encode(features: dict[str, float | str]) -> list[float]:
    """Raw request values -> the numeric row both models expect, in FEATURE_ORDER."""
    row: list[float] = []
    for name in FEATURE_ORDER:
        value = features[name]
        if name == "weatherSeverity" and isinstance(value, str):
            row.append(float(WEATHER_SEVERITY_CODE[value]))
        elif name == "cargoPriority" and isinstance(value, str):
            row.append(float(CARGO_PRIORITY_CODE[value]))
        else:
            row.append(float(value))
    return row


def out_of_training_range(features: dict[str, float | str]) -> list[str]:
    """Feature names whose value falls outside what the models were trained on."""
    flagged: list[str] = []
    for name, value in zip(FEATURE_ORDER, encode(features)):
        low, high = TRAINING_RANGE[name]
        if value < low or value > high:
            flagged.append(name)
    return flagged
