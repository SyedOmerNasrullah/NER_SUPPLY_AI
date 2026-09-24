"""
Train route-risk-xgb-v1.

    python -m training.train_route_risk            # refuses to replace a different v1 artifact
    python -m training.train_route_risk --force    # replace it deliberately

Writes
    artifacts/route-risk-xgb-v1.json        the XGBoost booster (native JSON, portable)
    artifacts/route-risk-xgb-v1.meta.json   features, encoding, split, metrics, dataset hash

Versioning discipline: a trained model is identified by its version string, and every
prediction persisted in PostgreSQL carries that string. If this script silently replaced v1 with
a model that behaves differently, the database would hold two populations of "v1" predictions
that disagree. So it refuses unless told otherwise — retraining with different data or
parameters should mean a new version, not an overwrite.

The training is deterministic (seeded split, seeded subsampling, single thread), so re-running
it on the same dataset reproduces the same bytes — and the refusal only triggers when something
actually changed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.domain import FEATURE_ORDER, ROAD_CONDITION_CODE, TRAINING_RANGE  # noqa: E402
from training import label_formula  # noqa: E402
from training.generate_route_dataset import DATASET_SEED, OUTPUT as DATASET, generate  # noqa: E402

MODEL_VERSION = "route-risk-xgb-v1"
ARTIFACTS = ROOT / "artifacts"
MODEL_PATH = ARTIFACTS / f"{MODEL_VERSION}.json"
META_PATH = ARTIFACTS / f"{MODEL_VERSION}.meta.json"

SPLIT_SEED = 7
TRAIN_FRACTION, VALIDATION_FRACTION = 0.70, 0.15  # remainder (0.15) is the held-out test set

#: Every feature is constrained to push risk only upward. This is domain knowledge, not a thumb
#: on the scale: more rain, a worse road, a steeper slope or a longer incident history should
#: never make a route SAFER, and an unconstrained tree ensemble can learn small inversions from
#: noise that would read as nonsense in a SHAP breakdown ("heavier rainfall decreases risk").
#: The constraint restricts the *shape* of the function, never its values.
MONOTONE = {name: 1 for name in FEATURE_ORDER}

HYPERPARAMETERS = {
    "objective": "reg:squarederror",
    "n_estimators": 1500,  # an upper bound; early stopping picks the real number
    "learning_rate": 0.05,
    "max_depth": 5,
    "min_child_weight": 3,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "reg_lambda": 1.0,
    "tree_method": "hist",
    "random_state": DATASET_SEED,
    "n_jobs": 1,  # multi-threaded histogram building is not bit-reproducible
    "early_stopping_rounds": 50,
    "eval_metric": "rmse",
}


def split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    order = np.random.default_rng(SPLIT_SEED).permutation(len(frame))
    n_train = int(len(frame) * TRAIN_FRACTION)
    n_val = int(len(frame) * VALIDATION_FRACTION)
    return (
        frame.iloc[order[:n_train]],
        frame.iloc[order[n_train : n_train + n_val]],
        frame.iloc[order[n_train + n_val :]],
    )


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="replace an existing, different v1 artifact")
    args = parser.parse_args()

    # Regenerate rather than trust whatever CSV is on disk: the generator is deterministic, and
    # a hand-edited dataset would otherwise train a model nobody can reproduce.
    frame = generate()
    DATASET.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(DATASET, index=False, lineterminator="\n")
    dataset_hash = sha256(DATASET)

    train, val, test = split(frame)
    features = list(FEATURE_ORDER)

    model = xgb.XGBRegressor(
        **HYPERPARAMETERS,
        monotone_constraints=tuple(MONOTONE[name] for name in features),
    )
    model.fit(
        train[features],
        train["riskScore"],
        eval_set=[(val[features], val["riskScore"])],
        verbose=False,
    )

    predictions = {
        "train": model.predict(train[features]),
        "validation": model.predict(val[features]),
        "test": model.predict(test[features]),
    }
    results = {
        "train": metrics(train["riskScore"].to_numpy(), predictions["train"]),
        "validation": metrics(val["riskScore"].to_numpy(), predictions["validation"]),
        "test": metrics(test["riskScore"].to_numpy(), predictions["test"]),
    }

    # Two reference points that keep the metrics honest:
    #   * a model that always predicts the training mean — the floor the model must beat;
    #   * the label noise itself — the ceiling. The labels carry Normal(0, 2.5) noise, so no
    #     model can get test RMSE meaningfully below ~2.5. Hitting it means XGBoost recovered
    #     essentially all of the SYNTHETIC function's signal; it says nothing about real roads.
    mean_baseline = metrics(
        test["riskScore"].to_numpy(),
        np.full(len(test), float(train["riskScore"].mean())),
    )
    noiseless = 100.0 * label_formula.risk_0_1(test)
    irreducible = metrics(test["riskScore"].to_numpy(), noiseless)

    meta = {
        "modelVersion": MODEL_VERSION,
        "modelType": "xgboost.XGBRegressor",
        "xgboostVersion": xgb.__version__,
        "objective": "Continuous route-risk score, 0-100 (regression).",
        "features": features,
        "featureEncoding": {
            "roadCondition": ROAD_CONDITION_CODE,
            "trafficLevel": "0 = low, 1 = medium, 2 = high (PROJECT_CONTRACT §1); continuous on [0, 2] for route-level means",
        },
        "trainingRange": {k: list(v) for k, v in TRAINING_RANGE.items()},
        "monotoneConstraints": MONOTONE,
        "hyperparameters": {k: v for k, v in HYPERPARAMETERS.items()},
        "bestIteration": int(model.best_iteration),
        "treesUsed": int(model.best_iteration) + 1,
        "dataset": {
            "synthetic": True,
            "statement": "This dataset is synthetic and intended for prototype/demo model development. It is not evidence of production accuracy.",
            "rows": len(frame),
            "seed": DATASET_SEED,
            "sha256": dataset_hash,
            "labelNoiseSd": label_formula.NOISE_SD,
            "labelWeights": label_formula.RISK_WEIGHTS,
        },
        "split": {
            "seed": SPLIT_SEED,
            "train": len(train),
            "validation": len(val),
            "test": len(test),
            "note": "Validation drives early stopping only. Test rows are never seen during fitting or model selection.",
        },
        "metrics": results,
        "referencePoints": {
            "predictTrainingMean_test": mean_baseline,
            "noiselessFormula_test": irreducible,
            "interpretation": "Test RMSE near the noiseless-formula RMSE means the model recovered nearly all learnable signal in a synthetic function the project wrote. It is not a measure of real-world accuracy.",
        },
    }

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    staging = ARTIFACTS / f".{MODEL_VERSION}.staging.json"
    model.save_model(staging)

    if MODEL_PATH.exists() and sha256(MODEL_PATH) != sha256(staging) and not args.force:
        staging.unlink()
        sys.exit(
            f"refusing to overwrite {MODEL_PATH.name}: the new model differs from the existing v1.\n"
            "A changed model should be a new version. Re-run with --force only if replacing v1 is intended."
        )

    staging.replace(MODEL_PATH)
    meta["artifactSha256"] = sha256(MODEL_PATH)
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"model      {MODEL_PATH.relative_to(ROOT)}  sha256 {meta['artifactSha256'][:16]}…")
    print(f"dataset    rows={len(frame)}  sha256 {dataset_hash[:16]}…")
    print(f"split      train={len(train)}  validation={len(val)}  test={len(test)}")
    print(f"trees      {meta['treesUsed']} (best iteration {meta['bestIteration']})")
    for name, m in results.items():
        print(f"{name:<11} MAE {m['mae']:.3f}   RMSE {m['rmse']:.3f}   R² {m['r2']:.4f}")
    print(f"mean-only  MAE {mean_baseline['mae']:.3f}   RMSE {mean_baseline['rmse']:.3f}   R² {mean_baseline['r2']:.4f}")
    print(f"noise floor RMSE {irreducible['rmse']:.3f} (labels carry Normal(0, {label_formula.NOISE_SD}) noise)")


if __name__ == "__main__":
    main()
