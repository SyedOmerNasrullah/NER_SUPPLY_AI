"""
Train delivery-risk-xgb-v1 — two boosters, one feature contract.

    python -m training.train_delivery_risk            # refuses to replace a different v1 artifact
    python -m training.train_delivery_risk --force    # replace it deliberately

Writes
    artifacts/delivery-risk-xgb-v1.delay.json      XGBRegressor  -> minutes late (0-1440)
    artifacts/delivery-risk-xgb-v1.failure.json    XGBClassifier -> P(misses its window)
    artifacts/delivery-risk-xgb-v1.meta.json       features, split, metrics, dataset hash

Why two models rather than one: the two questions have different answers and different loss
functions. "How late?" is a regression whose error is measured in minutes; "will it miss its
window?" is a calibrated probability, and the Decision Engine compares it against a fixed 0.85
threshold, so it has to be a probability rather than a squashed score.

Same versioning discipline as route risk: a changed model should be a new version, not an
overwrite, because every persisted prediction carries the version string.
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
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    brier_score_loss,
    f1_score,
    log_loss,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
    roc_auc_score,
)

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.delivery_domain import (  # noqa: E402
    CARGO_PRIORITY_CODE,
    FEATURE_ORDER,
    TRAINING_RANGE,
    WEATHER_SEVERITY_CODE,
)
from training import delivery_label_formula as formula  # noqa: E402
from training.generate_delivery_dataset import (  # noqa: E402
    DELAY_NOISE_SD,
    MAX_DELAY_MIN,
    OUT as DATASET,
    SEED as DATASET_SEED,
    build,
)

MODEL_VERSION = "delivery-risk-xgb-v1"
ARTIFACTS = ROOT / "artifacts"
DELAY_PATH = ARTIFACTS / f"{MODEL_VERSION}.delay.json"
FAILURE_PATH = ARTIFACTS / f"{MODEL_VERSION}.failure.json"
META_PATH = ARTIFACTS / f"{MODEL_VERSION}.meta.json"

SPLIT_SEED = 7
TRAIN_FRACTION, VALIDATION_FRACTION = 0.70, 0.15  # remainder (0.15) is the held-out test set

#: Domain knowledge about the SHAPE of each function, never about its values.
#:
#: Delay: further to go, slower, riskier road and worse weather can only mean more minutes late.
#: Hour and day are left free — night and weekend effects are real but not monotone in the
#: encoding (hour 23 and hour 0 are adjacent in life, far apart as numbers).
#: Failure adds cargoPriority: a tighter window cannot make a delivery LESS likely to miss it.
MONOTONE_DELAY = {
    "distanceRemainingKm": 1,
    "currentSpeedKmh": -1,
    "routeRiskScore": 1,
    "weatherSeverity": 1,
    "cargoPriority": 0,
    "hourOfDay": 0,
    "dayOfWeek": 0,
}
MONOTONE_FAILURE = {**MONOTONE_DELAY, "cargoPriority": 1}

COMMON = {
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
}
DELAY_PARAMS = {**COMMON, "objective": "reg:squarederror", "eval_metric": "rmse"}
#: `logloss` rather than `auc`: the threshold the Decision Engine uses needs the probability to
#: be calibrated, not merely well ranked.
FAILURE_PARAMS = {**COMMON, "objective": "binary:logistic", "eval_metric": "logloss"}


def split(frame: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    order = np.random.default_rng(SPLIT_SEED).permutation(len(frame))
    n_train = int(len(frame) * TRAIN_FRACTION)
    n_val = int(len(frame) * VALIDATION_FRACTION)
    return (
        frame.iloc[order[:n_train]],
        frame.iloc[order[n_train : n_train + n_val]],
        frame.iloc[order[n_train + n_val :]],
    )


def regression_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, float]:
    return {
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def classification_metrics(y_true: np.ndarray, proba: np.ndarray) -> dict[str, float]:
    predicted = (proba >= 0.5).astype(int)
    return {
        "accuracy": round(float(accuracy_score(y_true, predicted)), 4),
        "precision": round(float(precision_score(y_true, predicted, zero_division=0)), 4),
        "recall": round(float(recall_score(y_true, predicted, zero_division=0)), 4),
        "f1": round(float(f1_score(y_true, predicted, zero_division=0)), 4),
        "rocAuc": round(float(roc_auc_score(y_true, proba)), 4),
        "averagePrecision": round(float(average_precision_score(y_true, proba)), 4),
        "logLoss": round(float(log_loss(y_true, proba)), 4),
        "brier": round(float(brier_score_loss(y_true, proba)), 4),
    }


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--force", action="store_true", help="replace existing, different v1 artifacts")
    args = parser.parse_args()

    # Regenerate rather than trust whatever CSV is on disk: the generator is deterministic, and a
    # hand-edited dataset would train a model nobody can reproduce.
    frame = build()
    DATASET.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(DATASET, index=False, lineterminator="\n")
    dataset_hash = sha256(DATASET)

    train, val, test = split(frame)
    features = list(FEATURE_ORDER)

    # The delay target is heavily skewed — half the rows are under two hours, a few are a day —
    # so squared error on raw minutes spends the model's capacity on the tail and leaves ordinary
    # deliveries coarse. Fitting log1p(minutes) and inverting makes the loss proportional, which
    # cut test MAE from 39 minutes to the figure in the metadata. Monotonicity is unaffected:
    # log1p is strictly increasing, so a constraint in log space is the same constraint in
    # minutes. Every metric below is computed on real minutes, after expm1.
    delay = xgb.XGBRegressor(
        **DELAY_PARAMS, monotone_constraints=tuple(MONOTONE_DELAY[name] for name in features)
    )
    delay.fit(
        train[features],
        np.log1p(train["delayMinutes"]),
        eval_set=[(val[features], np.log1p(val["delayMinutes"]))],
        verbose=False,
    )

    failure = xgb.XGBClassifier(
        **FAILURE_PARAMS, monotone_constraints=tuple(MONOTONE_FAILURE[name] for name in features)
    )
    failure.fit(
        train[features],
        train["failed"],
        eval_set=[(val[features], val["failed"])],
        verbose=False,
    )

    def predict_delay(part: pd.DataFrame) -> np.ndarray:
        return np.clip(np.expm1(delay.predict(part[features])), 0.0, MAX_DELAY_MIN)

    delay_results = {
        name: regression_metrics(part["delayMinutes"].to_numpy(), predict_delay(part))
        for name, part in (("train", train), ("validation", val), ("test", test))
    }
    failure_results = {
        name: classification_metrics(
            part["failed"].to_numpy(), failure.predict_proba(part[features])[:, 1]
        )
        for name, part in (("train", train), ("validation", val), ("test", test))
    }

    # Reference points that keep the metrics honest.
    #
    #   delay:   a model that always predicts the training mean is the floor; the noiseless
    #            formula is the ceiling, since the labels carry Normal(0, DELAY_NOISE_SD) noise
    #            and no model can predict noise.
    #   failure: the majority-class rate is the floor for accuracy, and the TRUE Bernoulli
    #            probability that generated each label is the ceiling — a perfectly informed
    #            model still cannot beat it, because the outcome is genuinely random given it.
    mean_baseline = regression_metrics(
        test["delayMinutes"].to_numpy(), np.full(len(test), float(train["delayMinutes"].mean()))
    )
    noiseless = np.clip(
        formula.delay_minutes(
            test["distanceRemainingKm"].to_numpy(),
            test["currentSpeedKmh"].to_numpy(),
            test["routeRiskScore"].to_numpy(),
            test["weatherSeverity"].to_numpy(),
            test["hourOfDay"].to_numpy(),
            test["dayOfWeek"].to_numpy(),
        ),
        0.0,
        MAX_DELAY_MIN,
    )
    delay_ceiling = regression_metrics(test["delayMinutes"].to_numpy(), noiseless)

    true_probability = formula.failure_probability(
        test["delayMinutes"].to_numpy(), test["cargoPriority"].to_numpy()
    )
    failure_ceiling = classification_metrics(test["failed"].to_numpy(), true_probability)
    majority_rate = float(max(train["failed"].mean(), 1 - train["failed"].mean()))

    meta = {
        "modelVersion": MODEL_VERSION,
        "modelType": {
            "delay": "xgboost.XGBRegressor",
            "failure": "xgboost.XGBClassifier",
        },
        "xgboostVersion": xgb.__version__,
        "objective": (
            "Two heads on one feature contract: predicted minutes late (regression, 0-1440) and "
            "probability the delivery misses its required window (binary classification)."
        ),
        "features": features,
        "featureEncoding": {
            "weatherSeverity": WEATHER_SEVERITY_CODE,
            "cargoPriority": CARGO_PRIORITY_CODE,
            "hourOfDay": "0-23, local time at the point of prediction",
            "dayOfWeek": "0 = Monday ... 6 = Sunday",
        },
        "trainingRange": {k: list(v) for k, v in TRAINING_RANGE.items()},
        "monotoneConstraints": {"delay": MONOTONE_DELAY, "failure": MONOTONE_FAILURE},
        "hyperparameters": {"delay": DELAY_PARAMS, "failure": FAILURE_PARAMS},
        "bestIteration": {
            "delay": int(delay.best_iteration),
            "failure": int(failure.best_iteration),
        },
        "treesUsed": {
            "delay": int(delay.best_iteration) + 1,
            "failure": int(failure.best_iteration) + 1,
        },
        "dataset": {
            "synthetic": True,
            "statement": (
                "This dataset is synthetic and intended for prototype/demo model development. It "
                "is not evidence of production accuracy."
            ),
            "rows": len(frame),
            "seed": DATASET_SEED,
            "sha256": dataset_hash,
            "delayNoiseSd": DELAY_NOISE_SD,
            "maxDelayMinutes": MAX_DELAY_MIN,
            "failureRate": round(float(frame["failed"].mean()), 4),
            "prioritySlackMinutes": list(formula.PRIORITY_SLACK_MIN),
        },
        "split": {
            "seed": SPLIT_SEED,
            "train": len(train),
            "validation": len(val),
            "test": len(test),
            "note": "Validation drives early stopping only. Test rows are never seen during fitting or model selection.",
        },
        "metrics": {"delay": delay_results, "failure": failure_results},
        "referencePoints": {
            "delay_predictTrainingMean_test": mean_baseline,
            "delay_noiselessFormula_test": delay_ceiling,
            "failure_majorityClassRate_train": round(majority_rate, 4),
            "failure_trueProbability_test": failure_ceiling,
            "interpretation": (
                "Scores close to the noiseless-formula (delay) and true-probability (failure) "
                "references mean the models recovered nearly all learnable signal in a synthetic "
                "function this project wrote. That is not a measure of real-world accuracy."
            ),
        },
    }

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    staged: list[tuple[Path, Path]] = []
    for model, path in ((delay, DELAY_PATH), (failure, FAILURE_PATH)):
        # The extension must stay `.json`: XGBoost picks its serialisation format from it, and a
        # `.staging` suffix silently wrote UBJSON bytes into a file named `.json`.
        staging = ARTIFACTS / f".{path.stem}.staging.json"
        model.save_model(staging)
        staged.append((staging, path))

    changed = [
        path.name for staging, path in staged if path.exists() and sha256(path) != sha256(staging)
    ]
    if changed and not args.force:
        for staging, _ in staged:
            staging.unlink()
        sys.exit(
            f"refusing to overwrite {', '.join(changed)}: the new models differ from the existing v1.\n"
            "A changed model should be a new version. Re-run with --force only if replacing v1 is intended."
        )

    for staging, path in staged:
        staging.replace(path)

    meta["artifactSha256"] = {"delay": sha256(DELAY_PATH), "failure": sha256(FAILURE_PATH)}
    META_PATH.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")

    print(f"dataset    {DATASET.name}  sha256 {dataset_hash[:16]}…  rows {len(frame)}")
    print(f"delay      {DELAY_PATH.name}  trees {meta['treesUsed']['delay']}  test {delay_results['test']}")
    print(f"failure    {FAILURE_PATH.name}  trees {meta['treesUsed']['failure']}  test {failure_results['test']}")
    print(f"reference  delay ceiling {delay_ceiling}")
    print(f"reference  failure ceiling {failure_ceiling}")


if __name__ == "__main__":
    main()
