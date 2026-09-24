"""
Service configuration.

Read once at import. The internal token is the only secret this service holds, and it is never
logged, never echoed in a response, and never included in /health — the endpoint that exists
precisely to be looked at.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")

MODEL_VERSION = "route-risk-xgb-v1"
MODEL_PATH = ROOT / "artifacts" / f"{MODEL_VERSION}.json"
META_PATH = ROOT / "artifacts" / f"{MODEL_VERSION}.meta.json"

#: Shared secret between Express and this service. When unset the service refuses to serve
#: predictions at all rather than falling back to "open" — an internal endpoint that is quietly
#: public is worse than one that visibly does not start.
INTERNAL_TOKEN: str | None = os.environ.get("ML_INTERNAL_TOKEN") or None

#: Loopback by default. This is an internal service; binding it to 0.0.0.0 would make it
#: reachable from the network, which the architecture explicitly forbids.
HOST = os.environ.get("ML_HOST", "127.0.0.1")
PORT = int(os.environ.get("ML_PORT", "8000"))

TOP_FACTOR_COUNT = 5

# ---------------------------------------------------------------------------
# Delivery risk (two boosters, one contract) — added alongside route risk, not in place of it
# ---------------------------------------------------------------------------

DELIVERY_MODEL_VERSION = "delivery-risk-xgb-v1"
DELIVERY_DELAY_PATH = ROOT / "artifacts" / f"{DELIVERY_MODEL_VERSION}.delay.json"
DELIVERY_FAILURE_PATH = ROOT / "artifacts" / f"{DELIVERY_MODEL_VERSION}.failure.json"
DELIVERY_META_PATH = ROOT / "artifacts" / f"{DELIVERY_MODEL_VERSION}.meta.json"
