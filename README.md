# NER-SupplyAI

Predictive logistics intelligence for the North Eastern Region of India — SIH 2026 (SIH26002).

It is not a navigation system. It predicts when an essential delivery is likely to fail,
recommends what to do about it, and makes sure the right officer is actually told.

```
weather / incident ─► segment risk ─► route risk (ML) ─► delivery risk (ML)
                                                              │
                              adjusted ETA ─► supply stockout ─┘
                                                    │
                                          decision engine ─► recommendation ─► alert ─► SMS
```

---

## What runs

| Layer | Stack | Port |
|---|---|---|
| Web | React 18, Vite 5, TypeScript, Tailwind, Leaflet | 5173 |
| API | Express 4, Prisma 5, PostgreSQL (Neon), JWT auth | 4000 |
| ML | FastAPI, XGBoost, SHAP | 8000 |

The browser talks only to Express. Express holds every credential and is the only thing that
reaches PostgreSQL, the ML service, OpenRouteService, Gemini and Twilio.

## Models

| Version | Type | Answers | Test metrics |
|---|---|---|---|
| `route-risk-xgb-v1` | XGBRegressor, 12 features | corridor risk 0–100 | MAE 2.08 · RMSE 2.62 · R² 0.961 |
| `delivery-risk-xgb-v1` | XGBClassifier + XGBRegressor, 7 features | failure probability, minutes late | acc 0.890 · ROC-AUC 0.960 · delay MAE 29.8 min |

Both are explained per prediction with SHAP. **Both were trained on synthetic data this project
generated** — the metrics measure how well the models recovered a function we wrote, not accuracy
on real corridor telemetry. See `ml/MODEL_CARD.md` and `ml/MODEL_CARD_DELIVERY.md`.

The decision engine is deterministic and deliberately not a language model:

```
routeRisk ≥ 70 and a candidate ≥ 15 points safer  → REROUTE
adjustedStockoutHours < 48                        → PRE_POSITION
failureProbability ≥ 0.85                         → ALERT
otherwise                                         → NONE       (first match wins)
```

Gemini writes explanations and reads incident photographs. It never produces a number: a reply
that introduces a figure absent from the data is discarded in favour of a deterministic template.

## Running it

```bash
# ML service
cd ml && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# API
cd api && npm install && cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET
npx prisma migrate deploy && npm run seed && npm run dev

# Web
cd web && npm install && cp .env.example .env && npm run dev
```

Then open http://localhost:5173. The seeded demo accounts are listed on the login page.

### Two data modes

`web/.env` chooses which one:

- `VITE_DATA_SOURCE=demo` — deterministic fixtures in the browser. No database, no network, no
  keys. This is what runs in a presentation.
- `VITE_DATA_SOURCE=http` — the real Express API, PostgreSQL and the ML service.

Demo mode is frozen on purpose: the same rainfall, the same cascade, the same numbers every time.
`Reset Demo` restores that baseline — routes at 21 / 28 / 41 and Tawang at 2.1 days of medicine.

### Route geometry

Real road geometry comes from OpenRouteService, generated once and committed:

```bash
cd api && npm run routes:generate    # calls ORS, writes prisma/seed-data/ors-routes.json
cd api && npm run routes:apply       # no key needed: re-applies the committed artifact
```

Nothing calls ORS on a page load. A machine with no key and no internet runs the whole product
from the committed artifact, and the seed applies it automatically.

## Tests

```bash
cd ml  && .venv/Scripts/python -m pytest -q   # models, SHAP, contracts
cd api && npm run test:routes                 # route ownership, geometry, independent propagation
         npm run test:incidents               # reporting, matching, cascade
         npm run test:cascade                 # weather → route → delivery → supply → decision
         npm run test:intelligence            # comparison, supply projection, ladder, Gemini guard
         npm run test:delivery-risk  npm run test:ml  npm run test:sms
         npm run verify                       # baseline assertions against the database
```

## Provenance, and what is not real

Every figure on screen is labelled with where it came from: `ML_PREDICTION`,
`LLM_EXPLANATION`, `SYNTHETIC_OPERATIONAL`, `SIMULATION_EVENT`, `SYNTHETIC_ROUTE_GEOMETRY`,
`ORS_ROUTING`. That labelling is load-bearing, because much of the data is synthetic:

- training data for both models is generated, not observed;
- corridor conditions, inventory and deliveries are seeded demonstration data;
- hazard history on generated route segments is derived from route profiles, not surveyed;
- weather is a simulation control, not a live feed.

Road geometry, distance and elevation are real, from OpenRouteService.

## Documentation

`docs/PROJECT_CONTRACT.md` (the frozen API and domain contract), `docs/CONTRACT_DELTAS.md` (every
deviation, numbered and argued), `docs/BACKEND_ARCHITECTURE.md`, `docs/DEMO_RUNBOOK.md`,
`docs/DESIGN_SYSTEM.md`, and the two model cards in `ml/`.
