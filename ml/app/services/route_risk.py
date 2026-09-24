"""
Route-risk inference.

Loads the trained artifact once, verifies it is the artifact its metadata describes, and turns a
feature vector into a score with its SHAP explanation. There is no code path here that produces a
score without running the model — no fallback table, no demo numbers, no formula. If the artifact
is missing or corrupt, the service reports itself degraded and predictions fail loudly.
"""

from __future__ import annotations

import hashlib
import json

import numpy as np
import xgboost as xgb

from app.config import META_PATH, MODEL_PATH, MODEL_VERSION
from app.domain import FEATURE_ORDER, encode, out_of_training_range, risk_level
from app.services.shap_explainer import RouteRiskExplainer


class ModelUnavailable(RuntimeError):
    """The artifact could not be loaded or failed its integrity check."""


class RouteRiskModel:
    def __init__(self) -> None:
        if not MODEL_PATH.exists() or not META_PATH.exists():
            raise ModelUnavailable(
                f"{MODEL_VERSION} artifact not found — run `python -m training.train_route_risk`."
            )

        self.meta = json.loads(META_PATH.read_text(encoding="utf-8"))
        actual = hashlib.sha256(MODEL_PATH.read_bytes()).hexdigest()

        # The metadata records the hash of the booster it was written with. A mismatch means the
        # model file was replaced without retraining — and the metrics, feature order and
        # dataset hash in the metadata would then describe a different model than the one
        # answering. Refuse rather than serve predictions under the wrong description.
        if actual != self.meta.get("artifactSha256"):
            raise ModelUnavailable(f"{MODEL_VERSION} artifact does not match its metadata hash.")
        if tuple(self.meta.get("features", ())) != FEATURE_ORDER:
            raise ModelUnavailable(f"{MODEL_VERSION} was trained on a different feature order.")

        self.model = xgb.XGBRegressor()
        self.model.load_model(MODEL_PATH)
        self.explainer = RouteRiskExplainer(self.model)
        self.artifact_sha256 = actual

    def predict(self, features: dict[str, float | str], reference: str | None = None) -> dict:
        encoded = np.asarray(encode(features), dtype=float)
        raw = float(self.model.predict(encoded.reshape(1, -1))[0])

        # The regressor is trained on labels in [0, 100], but a tree ensemble can land a hair
        # outside the range at the extremes. Clip for the contract; report the raw value too.
        clipped = float(np.clip(raw, 0.0, 100.0))
        score = int(round(clipped))

        factors, _ = self.explainer.explain(encoded, features)

        extrapolated = out_of_training_range(features)
        warnings = [
            f"{name} is outside the training range; the prediction extrapolates on this feature."
            for name in extrapolated
        ]

        return {
            "modelVersion": MODEL_VERSION,
            "reference": reference,
            "riskScore": score,
            "riskProbability": round(clipped / 100.0, 4),
            "riskLevel": risk_level(score),
            "rawPrediction": round(raw, 4),
            "featureValues": dict(features),
            "encodedFeatures": {name: float(v) for name, v in zip(FEATURE_ORDER, encoded)},
            "topFactors": factors,
            "shapBaseValue": round(self.explainer.base_value, 4),
            "provenance": {
                "source": "ML_PREDICTION",
                "modelVersion": MODEL_VERSION,
                "modelType": self.meta["modelType"],
                "trainedOn": "synthetic",
                "datasetSha256": self.meta["dataset"]["sha256"],
                "artifactSha256": self.artifact_sha256,
                "explanationMethod": "shap.TreeExplainer (tree_path_dependent, exact Shapley values)",
            },
            "warnings": warnings,
        }
