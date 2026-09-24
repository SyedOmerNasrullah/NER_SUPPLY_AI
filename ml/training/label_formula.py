"""
The weighted risk relationship used to LABEL the synthetic training data.

Training-only. Nothing under `app/` may import this module — `tests/test_contract.py` fails if it
does. The model has to learn this relationship from examples; if inference could call it
directly, "prediction" would just be the formula wearing a model's name.

Provenance
----------
The weights and normalisations are the project's own, not new ones: PROJECT_CONTRACT's
ground-truth generator, first implemented in the original backend (`ml-service/app/
ground_truth.py`, itself ported from `groundTruthRisk.ts`) and cited by the frozen frontend's
factor fixtures ("30% weather / 25% road / 20% history / 15% terrain / 10% traffic"). Reusing
them keeps one definition of "risky" across the whole project.

The relationship
----------------
Five sub-scores, each normalised to [0, 1] against the maxima in `RANGE_MAX` and clamped:

    weather     = 0.45·rain24h + 0.20·rain6h + 0.15·rain3h + 0.10·rain1h + 0.10·wind
    road        = roadCondition / 2                    (GOOD 0 -> 0.0, FAIR 1 -> 0.5, POOR 2 -> 1.0)
    history     = 0.45·landslides + 0.30·floods + 0.25·closureFrequency
    terrain     = 0.65·slope + 0.35·elevation
    traffic     = trafficLevel / 2

    risk = 0.30·weather + 0.25·road + 0.20·history + 0.15·terrain + 0.10·traffic   (0..1)
    label = clip(100·risk + ε, 0, 100),   ε ~ Normal(0, NOISE_SD) from a seeded generator

Why it is not trivial to learn: the label depends on all twelve features at once, several of
them saturate (the clamps), the four rainfall windows are correlated but not identical, and the
noise means no input maps to exactly one output. A model has to recover the weights; it cannot
memorise a lookup.

Why it is honest to call the result ML: the model never sees this function — only 12,000
(features, label) pairs. It is, however, learning a function *we wrote*. High test accuracy
therefore measures how well XGBoost recovers a known synthetic relationship, and says nothing
about how well it would predict real road closures in the North East. MODEL_CARD.md says so.
"""

from __future__ import annotations

import numpy as np

#: Normalisation maxima. Every normalisation has a zero floor.
RANGE_MAX: dict[str, float] = {
    "rainfall1h": 25.0,
    "rainfall3h": 60.0,
    "rainfall6h": 95.0,
    "rainfall24h": 150.0,
    "windSpeedKmh": 70.0,
    "terrainSlopeDeg": 40.0,
    "elevationM": 4200.0,
    "historicalLandslides": 15.0,
    "historicalFloods": 12.0,
    "previousClosureFrequencyPct": 45.0,
    "trafficLevel": 2.0,
}

RISK_WEIGHTS: dict[str, float] = {
    "weather": 0.30,
    "road": 0.25,
    "history": 0.20,
    "terrain": 0.15,
    "traffic": 0.10,
}

#: Label noise, in risk points. Small enough that the relationship is learnable, large enough
#: that the model cannot hit it exactly — a perfect score would be a red flag, not a result.
NOISE_SD: float = 2.5


def _norm(values: np.ndarray, name: str) -> np.ndarray:
    return np.clip(np.asarray(values, dtype=float) / RANGE_MAX[name], 0.0, 1.0)


def risk_0_1(frame) -> np.ndarray:
    """The noiseless weighted risk in [0, 1] for a DataFrame with the twelve feature columns
    (roadCondition already encoded 0/1/2)."""
    weather = np.clip(
        0.45 * _norm(frame["rainfall24h"], "rainfall24h")
        + 0.20 * _norm(frame["rainfall6h"], "rainfall6h")
        + 0.15 * _norm(frame["rainfall3h"], "rainfall3h")
        + 0.10 * _norm(frame["rainfall1h"], "rainfall1h")
        + 0.10 * _norm(frame["windSpeedKmh"], "windSpeedKmh"),
        0.0,
        1.0,
    )
    road = np.asarray(frame["roadCondition"], dtype=float) / 2.0
    history = np.clip(
        0.45 * _norm(frame["historicalLandslides"], "historicalLandslides")
        + 0.30 * _norm(frame["historicalFloods"], "historicalFloods")
        + 0.25 * _norm(frame["previousClosureFrequencyPct"], "previousClosureFrequencyPct"),
        0.0,
        1.0,
    )
    terrain = np.clip(
        0.65 * _norm(frame["terrainSlopeDeg"], "terrainSlopeDeg")
        + 0.35 * _norm(frame["elevationM"], "elevationM"),
        0.0,
        1.0,
    )
    traffic = _norm(frame["trafficLevel"], "trafficLevel")

    return np.clip(
        RISK_WEIGHTS["weather"] * weather
        + RISK_WEIGHTS["road"] * road
        + RISK_WEIGHTS["history"] * history
        + RISK_WEIGHTS["terrain"] * terrain
        + RISK_WEIGHTS["traffic"] * traffic,
        0.0,
        1.0,
    )


def label(frame, rng: np.random.Generator) -> np.ndarray:
    """0-100 training label: the weighted risk plus seeded Gaussian noise."""
    noise = rng.normal(0.0, NOISE_SD, size=len(frame))
    return np.clip(100.0 * risk_0_1(frame) + noise, 0.0, 100.0)
