"""
Builds the synthetic delivery-risk dataset.

    python -m training.generate_delivery_dataset

Deterministic: one seed, one file, one SHA-256 that the trained models' metadata records. The
sampling is deliberately broad — a corridor delivery is sometimes 15 km out on a clear morning
and sometimes 400 km out in a storm — so the models see the whole operating envelope rather than
the narrow slice the demo happens to occupy.

THIS DATA IS SYNTHETIC. It stands in for delivery telemetry the project does not have, and no
metric computed on it is evidence of real-world accuracy.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pandas as pd

from app.delivery_domain import FEATURE_ORDER
from training.delivery_label_formula import delay_minutes, failure_probability

SEED = 20241118
ROWS = 14_000
#: Minutes. Observation noise on the delay label — vehicles are not stopwatches.
DELAY_NOISE_SD = 8.0

#: Minutes. The delay label is capped at 24 hours.
#:
#: The formula is unbounded: a vehicle crawling at 2 km/h with 600 km to go is theoretically
#: 140 hours late. That number is arithmetic rather than logistics — past a day the delivery has
#: failed and the operational answer no longer depends on the exact figure — and leaving the tail
#: in makes the regressor spend its capacity on cases nobody acts on differently. Predictions
#: therefore mean "minutes late, up to a day", which the API and the model card both state.
MAX_DELAY_MIN = 1440.0

OUT = Path(__file__).resolve().parents[1] / "data" / "delivery_risk_v1.csv"


def build(rows: int = ROWS, seed: int = SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    distance = rng.uniform(5.0, 600.0, rows)
    # Speed is uncorrelated with distance on purpose: the model must learn that a slow vehicle
    # far from home arrives late, rather than inferring one feature from the other.
    speed = np.clip(rng.normal(42.0, 14.0, rows), 0.0, 80.0)
    route_risk = np.clip(rng.beta(2.0, 3.0, rows) * 100.0, 0.0, 100.0)
    weather = rng.choice([0, 1, 2, 3], rows, p=[0.45, 0.30, 0.17, 0.08]).astype(float)
    priority = rng.choice([0, 1, 2, 3], rows, p=[0.25, 0.35, 0.25, 0.15]).astype(float)
    hour = rng.integers(0, 24, rows).astype(float)
    day = rng.integers(0, 7, rows).astype(float)

    clean_delay = delay_minutes(distance, speed, route_risk, weather, hour, day)
    observed_delay = np.clip(clean_delay + rng.normal(0.0, DELAY_NOISE_SD, rows), 0.0, MAX_DELAY_MIN)
    p_fail = failure_probability(observed_delay, priority)
    failed = (rng.random(rows) < p_fail).astype(int)

    frame = pd.DataFrame(
        {
            "distanceRemainingKm": distance.round(2),
            "currentSpeedKmh": speed.round(2),
            "routeRiskScore": route_risk.round(2),
            "weatherSeverity": weather,
            "cargoPriority": priority,
            "hourOfDay": hour,
            "dayOfWeek": day,
            "delayMinutes": observed_delay.round(2),
            "failed": failed,
        }
    )
    assert list(frame.columns)[: len(FEATURE_ORDER)] == list(FEATURE_ORDER)
    return frame


def main() -> None:
    frame = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(OUT, index=False, lineterminator="\n")
    digest = hashlib.sha256(OUT.read_bytes()).hexdigest()
    print(f"{OUT.name}: {len(frame)} rows, failure rate {frame['failed'].mean():.3f}")
    print(f"sha256 {digest}")


if __name__ == "__main__":
    main()
