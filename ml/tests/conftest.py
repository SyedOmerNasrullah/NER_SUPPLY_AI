"""Shared fixtures. Tests run against the real committed artifact — never a mock model."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# A fixed token for the test process only, set before the app imports its config. Tests never
# read the real ml/.env secret.
os.environ["ML_INTERNAL_TOKEN"] = "test-token-not-a-secret"

from fastapi.testclient import TestClient  # noqa: E402

TOKEN_HEADER = {"X-Internal-Token": "test-token-not-a-secret"}

#: Route A at rest, in the exact shape Express builds it: the corridor's baseline weather plus
#: Route A's profile rollup from the frozen demo (PROJECT_CONTRACT delta D12).
ROUTE_A_BASELINE = {
    "rainfall1h": 4.2,
    "rainfall3h": 10.1,
    "rainfall6h": 17.2,
    "rainfall24h": 31.0,
    "windSpeedKmh": 12.0,
    "roadCondition": "FAIR",
    "terrainSlopeDeg": 31.0,
    "elevationM": 4170.0,
    "historicalLandslides": 5.0,
    "historicalFloods": 2.0,
    "previousClosureFrequencyPct": 15.4,
    "trafficLevel": 1.2,
}

#: The same route after the demo's simulated heavy rainfall: the storm weather, and Route A's
#: after-rain profile (road degrades to POOR, traffic thins to 0.8).
ROUTE_A_HEAVY = {
    **ROUTE_A_BASELINE,
    "rainfall1h": 24.6,
    "rainfall3h": 59.0,
    "rainfall6h": 100.9,
    "rainfall24h": 148.0,
    "windSpeedKmh": 34.0,
    "roadCondition": "POOR",
    "trafficLevel": 0.8,
}


@pytest.fixture(scope="session")
def client():
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def model():
    from app.services.route_risk import RouteRiskModel

    return RouteRiskModel()


def predict(client, features, **extra):
    return client.post(
        "/internal/predict-route-risk",
        json={"features": features, **extra},
        headers=TOKEN_HEADER,
    )
