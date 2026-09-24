"""
Generate the deterministic synthetic route-risk training dataset.

    python -m training.generate_route_dataset          # writes data/route_risk_v1.csv

THIS DATASET IS SYNTHETIC. It is intended for prototype/demo model development. It is not
evidence of production accuracy, and nothing trained on it has been validated against real road
closures in the North Eastern Region.

Determinism
-----------
One `numpy.random.Generator` seeded with DATASET_SEED produces every value, including the label
noise. Same seed, same bytes: the file's SHA-256 is written into the model metadata, so a
trained artifact can always be traced to the exact rows it learned from.

Realism
-------
Features are not drawn independently. Real corridors have structure, and a model trained on
independent noise would learn nothing about how these quantities co-occur:

  * rainfall windows are nested — a storm's 24h total bounds its 6h, which bounds its 3h and 1h;
  * wind rises with storm intensity;
  * slope rises with elevation, and high roads are more often in POOR condition;
  * landslide history rises with slope; flood history is higher in low valleys;
  * closure frequency follows the incident history;
  * traffic is heavier on the plains than on the passes.

Each relationship has its own noise, so none of them is exact.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.domain import FEATURE_ORDER, TRAINING_RANGE  # noqa: E402
from training import label_formula  # noqa: E402

#: 18 Nov 2024 — the demo world's fixed date, reused so the seed means something to a reader.
DATASET_SEED = 20241118
DATASET_ROWS = 12_000
OUTPUT = ROOT / "data" / "route_risk_v1.csv"


def _clip(values: np.ndarray, name: str) -> np.ndarray:
    low, high = TRAINING_RANGE[name]
    return np.clip(values, low, high)


def generate(rows: int = DATASET_ROWS, seed: int = DATASET_SEED) -> pd.DataFrame:
    rng = np.random.default_rng(seed)

    # --- Weather: a latent storm intensity drives nested rainfall accumulations ------------
    # A three-regime mixture: dry spells, ordinary monsoon rain, and severe events. Without the
    # severe tail the model would never see what heavy rain looks like.
    regime = rng.choice(3, size=rows, p=[0.35, 0.45, 0.20])
    storm = np.where(
        regime == 0,
        rng.uniform(0.0, 0.15, rows),
        np.where(regime == 1, rng.uniform(0.10, 0.55, rows), rng.uniform(0.50, 1.0, rows)),
    )

    rain24 = _clip(storm * 150.0 * rng.uniform(0.75, 1.15, rows), "rainfall24h")
    rain6 = _clip(rain24 * rng.uniform(0.35, 0.70, rows), "rainfall6h")
    rain3 = _clip(rain6 * rng.uniform(0.45, 0.75, rows), "rainfall3h")
    rain1 = _clip(rain3 * rng.uniform(0.30, 0.55, rows), "rainfall1h")
    wind = _clip(5.0 + storm * 45.0 + rng.normal(0.0, 7.0, rows), "windSpeedKmh")

    # --- Terrain: elevation skewed low (most road-km are in the valleys) -------------------
    elevation = _clip(rng.gamma(shape=1.6, scale=900.0, size=rows), "elevationM")
    slope = _clip(4.0 + (elevation / 4200.0) * 28.0 + rng.normal(0.0, 6.0, rows), "terrainSlopeDeg")

    # Higher roads are poorer roads, but not always.
    altitude_share = elevation / 4200.0
    p_poor = np.clip(0.08 + 0.55 * altitude_share, 0.0, 0.9)
    p_fair = np.clip(0.30 + 0.10 * altitude_share, 0.0, 1.0 - p_poor)
    draw = rng.uniform(0.0, 1.0, rows)
    road = np.where(draw < p_poor, 2, np.where(draw < p_poor + p_fair, 1, 0))

    # --- History: incident counts follow the terrain that causes them ---------------------
    landslides = _clip(rng.poisson(0.5 + slope / 40.0 * 9.0), "historicalLandslides")
    floods = _clip(rng.poisson(0.4 + (1.0 - altitude_share) * 5.0), "historicalFloods")
    closure = _clip(
        1.0 + landslides * 1.6 + floods * 1.1 + rng.normal(0.0, 3.0, rows),
        "previousClosureFrequencyPct",
    )

    # --- Traffic: continuous on [0, 2], heavier on the plains -----------------------------
    traffic = _clip(1.6 - altitude_share * 1.3 + rng.normal(0.0, 0.35, rows), "trafficLevel")

    frame = pd.DataFrame(
        {
            "rainfall1h": np.round(rain1, 2),
            "rainfall3h": np.round(rain3, 2),
            "rainfall6h": np.round(rain6, 2),
            "rainfall24h": np.round(rain24, 2),
            "windSpeedKmh": np.round(wind, 2),
            "roadCondition": road.astype(int),
            "terrainSlopeDeg": np.round(slope, 2),
            "elevationM": np.round(elevation, 1),
            "historicalLandslides": landslides.astype(int),
            "historicalFloods": floods.astype(int),
            "previousClosureFrequencyPct": np.round(closure, 2),
            "trafficLevel": np.round(traffic, 3),
        }
    )[list(FEATURE_ORDER)]

    # Label last, from the same generator, so the noise is part of the deterministic stream.
    frame["riskScore"] = np.round(label_formula.label(frame, rng), 3)
    return frame


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    frame = generate()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    # lineterminator is pinned: the default follows the OS, and a CRLF/LF difference would give
    # the same rows two different hashes on two machines.
    frame.to_csv(OUTPUT, index=False, lineterminator="\n")

    print(f"wrote {OUTPUT.relative_to(ROOT)}  rows={len(frame)}  seed={DATASET_SEED}")
    print(f"sha256 {sha256_of(OUTPUT)}")
    print(frame["riskScore"].describe().round(2).to_string())


if __name__ == "__main__":
    main()
