"""
Route-risk service tests. Every assertion runs the committed model; nothing is mocked.

Numbered comments map to the Phase 5A test list.
"""

from __future__ import annotations

import copy

import numpy as np
import pytest

from tests.conftest import ROUTE_A_BASELINE, ROUTE_A_HEAVY, TOKEN_HEADER, predict


# 1 — health ---------------------------------------------------------------------------------

def test_health_reports_loaded_model_without_leaking_the_token(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["modelLoaded"] is True
    assert body["modelVersion"] == "route-risk-xgb-v1"
    assert body["authConfigured"] is True
    assert "test-token-not-a-secret" not in r.text


# 2 — valid prediction -----------------------------------------------------------------------

def test_valid_prediction_has_the_full_contract(client):
    r = predict(client, ROUTE_A_BASELINE, reference="route-a")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["modelVersion"] == "route-risk-xgb-v1"
    assert body["reference"] == "route-a"
    assert 0 <= body["riskScore"] <= 100
    assert body["riskLevel"] in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
    assert body["featureValues"] == ROUTE_A_BASELINE
    assert body["provenance"]["source"] == "ML_PREDICTION"
    assert body["provenance"]["trainedOn"] == "synthetic"
    assert float(r.headers["X-Inference-Ms"]) >= 0


def test_risk_level_follows_contract_bands(client):
    from app.domain import risk_level

    body = predict(client, ROUTE_A_BASELINE).json()
    assert body["riskLevel"] == risk_level(body["riskScore"])
    assert [risk_level(s) for s in (39, 40, 69, 70, 84, 85)] == [
        "LOW", "MEDIUM", "MEDIUM", "HIGH", "HIGH", "CRITICAL",
    ]


# 3 — invalid input --------------------------------------------------------------------------

@pytest.mark.parametrize(
    "field,value",
    [
        ("rainfall1h", -1.0),          # negative rain is not an extrapolation, it is wrong
        ("terrainSlopeDeg", 95.0),     # past vertical
        ("trafficLevel", 3.0),         # contract range is 0-2
        ("roadCondition", "MUDDY"),    # not in GOOD/FAIR/POOR
        ("elevationM", "high"),        # not a number
    ],
)
def test_invalid_values_are_rejected_cleanly(client, field, value):
    features = {**ROUTE_A_BASELINE, field: value}
    r = predict(client, features)
    assert r.status_code == 422
    body = r.json()
    assert body["error"] == "Invalid route-risk features."
    assert any(field in d["field"] for d in body["detail"])
    assert "Traceback" not in r.text


def test_unknown_feature_is_rejected_not_ignored(client):
    # `season` was dropped from the contract; sending it must fail visibly.
    r = predict(client, {**ROUTE_A_BASELINE, "season": 2})
    assert r.status_code == 422


# 4 — missing feature ------------------------------------------------------------------------

def test_missing_feature_is_rejected(client):
    features = copy.deepcopy(ROUTE_A_BASELINE)
    del features["rainfall24h"]
    r = predict(client, features)
    assert r.status_code == 422
    assert any("rainfall24h" in d["field"] for d in r.json()["detail"])


def test_prediction_requires_the_internal_token(client):
    r = client.post("/internal/predict-route-risk", json={"features": ROUTE_A_BASELINE})
    assert r.status_code == 401
    r = client.post(
        "/internal/predict-route-risk",
        json={"features": ROUTE_A_BASELINE},
        headers={"X-Internal-Token": "wrong"},
    )
    assert r.status_code == 401


def test_no_cors_headers_so_browsers_cannot_read_responses(client):
    r = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_interactive_docs_are_disabled(client):
    assert client.get("/docs").status_code == 404
    assert client.get("/openapi.json").status_code == 404


# 5 — categorical encoding -------------------------------------------------------------------

def test_road_condition_encoding_matches_contract():
    from app.domain import ROAD_CONDITION_CODE, encode, FEATURE_ORDER

    assert ROAD_CONDITION_CODE == {"GOOD": 0, "FAIR": 1, "POOR": 2}
    idx = FEATURE_ORDER.index("roadCondition")
    for name, code in ROAD_CONDITION_CODE.items():
        assert encode({**ROUTE_A_BASELINE, "roadCondition": name})[idx] == code


def test_worse_road_never_lowers_risk(client):
    scores = [
        predict(client, {**ROUTE_A_BASELINE, "roadCondition": c}).json()["rawPrediction"]
        for c in ("GOOD", "FAIR", "POOR")
    ]
    assert scores[0] <= scores[1] <= scores[2]
    assert scores[2] - scores[0] > 5, "road condition should move risk materially"


# 6 — artifact loading -----------------------------------------------------------------------

def test_artifact_loads_and_matches_its_metadata(model):
    assert model.meta["modelVersion"] == "route-risk-xgb-v1"
    assert model.meta["dataset"]["synthetic"] is True
    assert model.artifact_sha256 == model.meta["artifactSha256"]
    assert model.meta["split"]["train"] + model.meta["split"]["validation"] + model.meta["split"]["test"] == model.meta["dataset"]["rows"]


def test_tampered_artifact_is_refused(tmp_path, monkeypatch):
    import app.services.route_risk as rr

    fake = tmp_path / "route-risk-xgb-v1.json"
    fake.write_bytes(rr.MODEL_PATH.read_bytes() + b" ")
    monkeypatch.setattr(rr, "MODEL_PATH", fake)
    with pytest.raises(rr.ModelUnavailable, match="metadata hash"):
        rr.RouteRiskModel()


# 7 — determinism ----------------------------------------------------------------------------

def test_prediction_is_deterministic(client):
    a = predict(client, ROUTE_A_BASELINE).json()
    b = predict(client, ROUTE_A_BASELINE).json()
    assert a["rawPrediction"] == b["rawPrediction"]
    assert a["topFactors"] == b["topFactors"]


# 8 — SHAP -----------------------------------------------------------------------------------

def test_shap_values_are_additive_to_the_prediction(model):
    # The defining property of a SHAP explanation: base value + Σ contributions = prediction.
    # If this failed, the factors would not be an explanation of THIS number.
    from app.domain import encode

    row = np.asarray(encode(ROUTE_A_BASELINE), dtype=float)
    _, values = model.explainer.explain(row, ROUTE_A_BASELINE)
    prediction = float(model.model.predict(row.reshape(1, -1))[0])
    assert abs(model.explainer.base_value + values.sum() - prediction) < 1e-3


def test_factors_carry_real_values_and_signed_contributions(client):
    body = predict(client, ROUTE_A_HEAVY).json()
    for f in body["topFactors"]:
        assert f["value"] == ROUTE_A_HEAVY[f["feature"]]
        assert (f["shapValue"] >= 0) == (f["direction"] == "increases_risk")


# 9 — topFactors non-empty ---------------------------------------------------------------------

@pytest.mark.parametrize("features", [ROUTE_A_BASELINE, ROUTE_A_HEAVY])
def test_top_factors_are_never_empty(client, features):
    factors = predict(client, features).json()["topFactors"]
    assert len(factors) == 5
    assert len({f["feature"] for f in factors}) == 5
    magnitudes = [abs(f["shapValue"]) for f in factors]
    assert magnitudes == sorted(magnitudes, reverse=True)


# 10 — contribution percentages --------------------------------------------------------------

@pytest.mark.parametrize("features", [ROUTE_A_BASELINE, ROUTE_A_HEAVY])
def test_contribution_pct_is_normalised_over_displayed_factors(client, features):
    factors = predict(client, features).json()["topFactors"]
    total = sum(f["contributionPct"] for f in factors)
    assert abs(total - 100.0) < 0.6  # five values each rounded to 0.1
    displayed = sum(abs(f["shapValue"]) for f in factors)
    for f in factors:
        assert abs(f["contributionPct"] - abs(f["shapValue"]) / displayed * 100) < 0.11


# Heavy-rain behaviour -----------------------------------------------------------------------

def test_heavy_rain_raises_risk_and_rainfall_drives_it(client):
    base = predict(client, ROUTE_A_BASELINE).json()
    heavy = predict(client, ROUTE_A_HEAVY).json()
    assert heavy["riskScore"] > base["riskScore"] + 15
    rain = [f for f in heavy["topFactors"] if f["feature"].startswith("rainfall")]
    assert rain and all(f["direction"] == "increases_risk" for f in rain)


def test_rainfall_is_monotone(client):
    scores = []
    for rain24 in (0, 30, 60, 90, 120, 150):
        f = {**ROUTE_A_BASELINE, "rainfall24h": float(rain24)}
        scores.append(predict(client, f).json()["rawPrediction"])
    assert scores == sorted(scores)


def test_out_of_range_input_is_scored_and_flagged(client):
    # 100.9 mm in 6h is physically real but beyond the 95 mm the model trained on.
    body = predict(client, ROUTE_A_HEAVY).json()
    assert any("rainfall6h" in w for w in body["warnings"])
