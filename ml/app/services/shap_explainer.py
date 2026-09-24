"""
SHAP explanations for the route-risk model.

Every number this module returns is computed from the trained model for the specific input. None
is looked up, scaled to match the old demo, or produced by a language model.

Method: `shap.TreeExplainer` in its default tree-path-dependent mode, which gives exact Shapley
values for tree ensembles in polynomial time. For each prediction it yields

    prediction = base_value + Σ shap_value[feature]

— additivity, which `tests/` checks on every run. That identity is what makes the factors an
explanation of THIS number rather than a general statement about the model.

How the contribution percentages are formed
-------------------------------------------
1. Rank all twelve features by |SHAP|.
2. Keep the top five.
3. contributionPct = |shap_i| / Σ(|shap| over those five) × 100.

The denominator is the displayed factors only, so the five percentages sum to 100 and a reader
sees "of what is shown, this much is rainfall". The raw SHAP value travels alongside, so nothing
is lost by the normalisation, and the sign is reported as a direction rather than hidden in a
magnitude.
"""

from __future__ import annotations

import numpy as np
import shap
import xgboost as xgb

from app.config import TOP_FACTOR_COUNT
from app.domain import FEATURE_LABEL, FEATURE_ORDER


class RouteRiskExplainer:
    def __init__(self, model: xgb.XGBRegressor) -> None:
        self._explainer = shap.TreeExplainer(model)
        base = self._explainer.expected_value
        self.base_value = float(np.asarray(base).reshape(-1)[0])

    def explain(
        self,
        encoded_row: np.ndarray,
        raw_values: dict[str, float | str],
    ) -> tuple[list[dict], np.ndarray]:
        """Returns (top factors, all twelve SHAP values in FEATURE_ORDER)."""
        values = np.asarray(self._explainer.shap_values(encoded_row.reshape(1, -1))).reshape(-1)

        ranked = sorted(range(len(FEATURE_ORDER)), key=lambda i: abs(values[i]), reverse=True)
        top = ranked[:TOP_FACTOR_COUNT]
        displayed = float(sum(abs(values[i]) for i in top))

        factors: list[dict] = []
        for i in top:
            name = FEATURE_ORDER[i]
            # An all-zero explanation is theoretically possible (an input exactly at the base
            # value on every axis). Rather than divide by zero, report zero shares — the factors
            # are still listed, so the response is never empty.
            share = (abs(values[i]) / displayed * 100.0) if displayed > 0 else 0.0
            factors.append(
                {
                    "factor": FEATURE_LABEL[name],
                    "feature": name,
                    "value": raw_values[name],
                    "shapValue": round(float(values[i]), 4),
                    # Route risk is predicted directly in points, so that is what a SHAP value
                    # here is measured in. Stated rather than assumed, like the delivery heads.
                    "shapUnit": "risk_points",
                    "contributionPct": round(share, 1),
                    "direction": "increases_risk" if values[i] >= 0 else "decreases_risk",
                }
            )
        return factors, values


def explain_factors(
    explainer: "shap.TreeExplainer",
    encoded_row: np.ndarray,
    raw_values: dict[str, float | str],
    feature_order: tuple[str, ...],
    feature_label: dict[str, str],
    unit: str,
    top_n: int = TOP_FACTOR_COUNT,
) -> tuple[list[dict], np.ndarray, float]:
    """
    The same ranking and normalisation as `RouteRiskExplainer`, for any tree model.

    Added for the delivery-risk pair, which has its own feature order and two heads. Returns
    (top factors, all SHAP values in `feature_order`, base value). `unit` says what a shapValue
    is measured in — minutes for the delay regressor, log-odds for the failure classifier — so
    a reader is never left to assume it is a percentage.
    """
    values = np.asarray(explainer.shap_values(encoded_row.reshape(1, -1))).reshape(-1)
    base = float(np.asarray(explainer.expected_value).reshape(-1)[0])

    ranked = sorted(range(len(feature_order)), key=lambda i: abs(values[i]), reverse=True)
    top = ranked[:top_n]
    displayed = float(sum(abs(values[i]) for i in top))

    factors: list[dict] = []
    for i in top:
        name = feature_order[i]
        # float() first: the SHAP values are float32, and rounding one yields a float32 whose
        # JSON form is 49.400001525878906 rather than 49.4.
        share = float(abs(values[i]) / displayed * 100.0) if displayed > 0 else 0.0
        factors.append(
            {
                "factor": feature_label[name],
                "feature": name,
                "value": raw_values[name],
                "shapValue": round(float(values[i]), 4),
                "shapUnit": unit,
                "contributionPct": round(share, 1),
                "direction": "increases_risk" if values[i] >= 0 else "decreases_risk",
            }
        )
    return factors, values, base
