"""
Delivery-risk inference — two heads, one feature vector.

Loads both trained artifacts once, verifies each is the artifact its metadata describes, and
turns a feature vector into:

    predictedDelayMinutes   how late the delivery is expected to be (regression, 0-1440)
    failureProbability      P(it misses its required window) (calibrated classification)

each with its own SHAP explanation. As with route risk there is no path here that produces a
number without running a model — no fallback table, no demo values, no formula. If an artifact is
missing or corrupt the service reports itself degraded and predictions fail loudly.

The delay model is trained on log1p(minutes), so inference inverts with expm1 and clips to the
trained range. Monotonicity survives the transform: log1p is strictly increasing.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import shap
import xgboost as xgb

from app.config import (
    DELIVERY_DELAY_PATH,
    DELIVERY_FAILURE_PATH,
    DELIVERY_META_PATH,
    DELIVERY_MODEL_VERSION,
)
from app.delivery_domain import FEATURE_LABEL, FEATURE_ORDER, encode, out_of_training_range
from app.services.route_risk import ModelUnavailable
from app.services.shap_explainer import explain_factors

#: Mirrors the cap the training labels were clipped at. A prediction cannot claim more.
MAX_DELAY_MIN = 1440.0


class DeliveryRiskModel:
    def __init__(self) -> None:
        missing = [p.name for p in (DELIVERY_DELAY_PATH, DELIVERY_FAILURE_PATH, DELIVERY_META_PATH) if not p.exists()]
        if missing:
            raise ModelUnavailable(
                f"{DELIVERY_MODEL_VERSION} artifacts not found ({', '.join(missing)}) — "
                "run `python -m training.train_delivery_risk`."
            )

        self.meta = json.loads(DELIVERY_META_PATH.read_text(encoding="utf-8"))
        hashes = {
            "delay": hashlib.sha256(DELIVERY_DELAY_PATH.read_bytes()).hexdigest(),
            "failure": hashlib.sha256(DELIVERY_FAILURE_PATH.read_bytes()).hexdigest(),
        }
        # The metadata records the hash of the boosters it was written with. A mismatch means an
        # artifact was replaced without retraining, so the metrics and dataset hash in the
        # metadata would describe a different model than the one answering.
        if hashes != self.meta.get("artifactSha256"):
            raise ModelUnavailable(f"{DELIVERY_MODEL_VERSION} artifacts do not match their metadata hashes.")
        if tuple(self.meta.get("features", ())) != FEATURE_ORDER:
            raise ModelUnavailable(f"{DELIVERY_MODEL_VERSION} was trained on a different feature order.")

        self.delay = xgb.XGBRegressor()
        self.delay.load_model(DELIVERY_DELAY_PATH)
        self.failure = xgb.XGBClassifier()
        self.failure.load_model(DELIVERY_FAILURE_PATH)

        self.delay_explainer = shap.TreeExplainer(self.delay)
        self.failure_explainer = shap.TreeExplainer(self.failure)
        self.artifact_sha256 = hashes

    def predict(self, features: dict[str, float | str], reference: str | None = None) -> dict:
        encoded = np.asarray(encode(features), dtype=float)
        row = encoded.reshape(1, -1)

        log_minutes = float(self.delay.predict(row)[0])
        raw_minutes = float(np.expm1(log_minutes))
        minutes = float(np.clip(raw_minutes, 0.0, MAX_DELAY_MIN))

        probability = float(self.failure.predict_proba(row)[0, 1])

        # Two explanations, in two different units, each labelled as such: the delay factors are
        # in log-minutes (the space the regressor was fitted in) and the failure factors in
        # log-odds (the space the classifier was fitted in). Neither is a percentage of the
        # prediction, which is exactly why `shapUnit` travels with every value.
        delay_factors, _, delay_base = explain_factors(
            self.delay_explainer, encoded, features, FEATURE_ORDER, FEATURE_LABEL, "log1p_minutes"
        )
        failure_factors, _, failure_base = explain_factors(
            self.failure_explainer, encoded, features, FEATURE_ORDER, FEATURE_LABEL, "log_odds"
        )

        warnings = [
            f"{name} is outside the training range; the prediction extrapolates on this feature."
            for name in out_of_training_range(features)
        ]
        if raw_minutes > MAX_DELAY_MIN:
            warnings.append(
                "The predicted delay was capped at 1440 minutes, the maximum the model was trained on."
            )

        return {
            "modelVersion": DELIVERY_MODEL_VERSION,
            "reference": reference,
            "failureProbability": round(probability, 4),
            "predictedDelayMinutes": int(round(minutes)),
            "rawDelayMinutes": round(raw_minutes, 4),
            "featureValues": dict(features),
            "encodedFeatures": {name: float(v) for name, v in zip(FEATURE_ORDER, encoded)},
            "topFactors": failure_factors,
            "delayFactors": delay_factors,
            "shapBaseValue": round(failure_base, 4),
            "delayShapBaseValue": round(delay_base, 4),
            "provenance": {
                "source": "ML_PREDICTION",
                "modelVersion": DELIVERY_MODEL_VERSION,
                "modelType": (
                    f"{self.meta['modelType']['failure']} (failure) + "
                    f"{self.meta['modelType']['delay']} (delay)"
                ),
                "trainedOn": "synthetic",
                "datasetSha256": self.meta["dataset"]["sha256"],
                "artifactSha256": f"{self.artifact_sha256['failure']}/{self.artifact_sha256['delay']}",
                "explanationMethod": "shap.TreeExplainer (tree_path_dependent, exact Shapley values)",
            },
            "warnings": warnings,
        }
