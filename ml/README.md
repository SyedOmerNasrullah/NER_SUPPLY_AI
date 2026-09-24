# NER-SupplyAI — internal ML service

Route-risk prediction (Phase 5A). XGBoost for the score, SHAP for the explanation, FastAPI to
serve both — **to Express only.** The browser never calls this service.

```
React ──► Express ──► FastAPI (this) ──► XGBoost + SHAP
            │
            └──► PostgreSQL (predictions persisted with provenance)
```

## Layout

```
ml/
├─ app/                      inference — FastAPI routes, schemas, model wrapper
│  ├─ main.py                /health, /internal/predict-route-risk
│  ├─ domain.py              feature order, encoding, risk bands (shared by training + inference)
│  ├─ schemas.py             Pydantic request/response
│  └─ services/
│     ├─ route_risk.py       loads + verifies the artifact, predicts
│     └─ shap_explainer.py   TreeExplainer -> top factors
├─ training/                 training only — never imported by app/
│  ├─ label_formula.py       the documented weighted relationship that labels the data
│  ├─ generate_route_dataset.py
│  └─ train_route_risk.py
├─ artifacts/                route-risk-xgb-v1.json + .meta.json (committed)
├─ data/                     generated dataset (gitignored — regenerated from its seed)
├─ tests/                    pytest
└─ MODEL_CARD.md
```

## Setup

```bash
cd ml
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
```

Create `ml/.env` (gitignored):

```
ML_INTERNAL_TOKEN=<same value as api/.env ML_INTERNAL_TOKEN>
ML_HOST=127.0.0.1
ML_PORT=8000
```

## Commands

```bash
python -m training.generate_route_dataset     # deterministic dataset, prints its SHA-256
python -m training.train_route_risk           # trains v1; refuses to overwrite a different v1
python -m pytest -q                           # 32 tests against the committed artifact
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then in `api/.env` set `ML_MODE=live` and restart Express. With `ML_MODE=demo` (the default)
Express never contacts this service.

## Endpoints

| | |
|---|---|
| `GET /health` | model loaded? auth configured? (never the token) |
| `POST /internal/predict-route-risk` | `X-Internal-Token` required. Body `{ features: {…12…}, reference? }` |

Errors are JSON — `{"error": "...", "detail": [...]}` — with no traceback. Interactive docs are
disabled; the service sends no CORS headers and binds to loopback.

## Latency (this machine)

| | |
|---|---|
| Process start → model ready (cold) | ~22.5 s — almost all Python/numba imports; the model loads in ~1.8 s |
| First prediction | ~18 ms round trip (3 ms in-model) |
| Warm, median of 100 | ~2.8 ms round trip, 1.6 ms in-model (p95 3.6 / 2.2 ms) |

Start the service before presenting, not during.
