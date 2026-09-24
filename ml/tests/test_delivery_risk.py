"""
Delivery-risk model tests.

The same standard the route-risk tests hold: the model is exercised through the real service
object and the real HTTP endpoint, the SHAP output is checked for additivity rather than merely
for being present, and the behaviour the domain claims (further, slower, riskier, worse weather →
later) is asserted, not assumed.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.delivery_domain import CARGO_PRIORITY_CODE, FEATURE_ORDER, encode
from app.services.delivery_risk import MAX_DELAY_MIN, DeliveryRiskModel

BASE = {
    "distanceRemainingKm": 180.0,
    "currentSpeedKmh": 38.0,
    "routeRiskScore": 21.0,
    "weatherSeverity": 1.0,
    "cargoPriority": 3.0,
    "hourOfDay": 10.0,
    "dayOfWeek": 0.0,
}


@pytest.fixture(scope="module")
def model() -> DeliveryRiskModel:
    return DeliveryRiskModel()


def test_contract_is_seven_features_in_order():
    assert FEATURE_ORDER == (
        "distanceRemainingKm",
        "currentSpeedKmh",
        "routeRiskScore",
        "weatherSeverity",
        "cargoPriority",
        "hourOfDay",
        "dayOfWeek",
    )


def test_names_and_codes_both_encode():
    assert encode({**BASE, "cargoPriority": "CRITICAL", "weatherSeverity": "MODERATE"}) == encode(BASE)
    assert CARGO_PRIORITY_CODE == {"LOW": 0, "MEDIUM": 1, "HIGH": 2, "CRITICAL": 3}


def test_prediction_is_in_contract_range(model: DeliveryRiskModel):
    out = model.predict(BASE)
    assert 0.0 <= out["failureProbability"] <= 1.0
    assert 0 <= out["predictedDelayMinutes"] <= MAX_DELAY_MIN
    assert out["modelVersion"] == "delivery-risk-xgb-v1"
    assert out["provenance"]["source"] == "ML_PREDICTION"
    assert out["provenance"]["trainedOn"] == "synthetic"


def test_prediction_is_deterministic(model: DeliveryRiskModel):
    first, second = model.predict(BASE), model.predict(BASE)
    assert first["failureProbability"] == second["failureProbability"]
    assert first["predictedDelayMinutes"] == second["predictedDelayMinutes"]


@pytest.mark.parametrize(
    "feature,worse",
    [
        ("distanceRemainingKm", 520.0),
        ("routeRiskScore", 92.0),
        ("weatherSeverity", 3.0),
    ],
)
def test_worse_conditions_never_reduce_the_delay(model: DeliveryRiskModel, feature: str, worse: float):
    """The monotone constraints are the point: these can only push the delay up."""
    calm = model.predict(BASE)["predictedDelayMinutes"]
    rough = model.predict({**BASE, feature: worse})["predictedDelayMinutes"]
    assert rough >= calm


def test_a_slower_vehicle_is_never_earlier(model: DeliveryRiskModel):
    fast = model.predict({**BASE, "currentSpeedKmh": 60.0})["predictedDelayMinutes"]
    slow = model.predict({**BASE, "currentSpeedKmh": 12.0})["predictedDelayMinutes"]
    assert slow >= fast


def test_tighter_cargo_priority_never_lowers_failure_probability(model: DeliveryRiskModel):
    low = model.predict({**BASE, "cargoPriority": 0.0})["failureProbability"]
    critical = model.predict({**BASE, "cargoPriority": 3.0})["failureProbability"]
    assert critical >= low


def test_a_storm_raises_both_heads(model: DeliveryRiskModel):
    calm = model.predict(BASE)
    storm = model.predict({**BASE, "routeRiskScore": 87.0, "weatherSeverity": 3.0, "currentSpeedKmh": 22.0})
    assert storm["predictedDelayMinutes"] > calm["predictedDelayMinutes"]
    assert storm["failureProbability"] > calm["failureProbability"]


def test_shap_is_additive_for_both_heads(model: DeliveryRiskModel):
    """
    prediction == base + Σ shap, in each model's own space. This is what makes the factors an
    explanation of THIS number rather than a general statement about the model.
    """
    row = np.asarray(encode(BASE), dtype=float).reshape(1, -1)

    delay_shap = np.asarray(model.delay_explainer.shap_values(row)).reshape(-1)
    delay_base = float(np.asarray(model.delay_explainer.expected_value).reshape(-1)[0])
    assert float(model.delay.predict(row)[0]) == pytest.approx(delay_base + delay_shap.sum(), abs=1e-3)

    failure_shap = np.asarray(model.failure_explainer.shap_values(row)).reshape(-1)
    failure_base = float(np.asarray(model.failure_explainer.expected_value).reshape(-1)[0])
    margin = float(model.failure.predict(row, output_margin=True)[0])
    assert margin == pytest.approx(failure_base + failure_shap.sum(), abs=1e-3)


def test_factors_are_labelled_ranked_and_carry_their_unit(model: DeliveryRiskModel):
    out = model.predict(BASE)
    for key, unit in (("topFactors", "log_odds"), ("delayFactors", "log1p_minutes")):
        factors = out[key]
        assert len(factors) == 5
        assert [abs(f["shapValue"]) for f in factors] == sorted(
            (abs(f["shapValue"]) for f in factors), reverse=True
        )
        assert sum(f["contributionPct"] for f in factors) == pytest.approx(100.0, abs=0.5)
        assert all(f["shapUnit"] == unit for f in factors)
        assert all(f["direction"] in ("increases_risk", "decreases_risk") for f in factors)


def test_out_of_range_input_is_scored_and_flagged(model: DeliveryRiskModel):
    out = model.predict({**BASE, "distanceRemainingKm": 900.0})
    assert out["predictedDelayMinutes"] >= 0
    assert any("distanceRemainingKm" in w for w in out["warnings"])


def test_inference_never_imports_the_delivery_label_formula():
    """
    Same rule as route risk, and checked the same way: by parsing imports rather than grepping
    for the name, so a docstring that merely *mentions* the formula does not fail the test while
    a real import does.
    """
    import ast
    from pathlib import Path

    offenders = []
    for path in (Path(__file__).resolve().parents[1] / "app").rglob("*.py"):
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            names = []
            if isinstance(node, ast.Import):
                names = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                names = [node.module or ""]
            if any(n.startswith("training") for n in names):
                offenders.append(path.name)
    assert offenders == []
