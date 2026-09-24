# What is actually ML — audit before Phase 6E

Taken from the running system on 2026-09-24, not from the UI labels. Every claim below was
checked against a live response or the code that produces it.

## The contradiction

The status rail said **"Models: not connected"** while nineteen panels carried a
**"Model prediction"** provenance tag. Both were rendered unconditionally from different
sources: the rail from `isDemoMode`, the tag from nothing at all. In demo mode the tag was
simply false.

## What was genuinely ML before this phase

| Thing | Verdict | Evidence |
|---|---|---|
| `POST /api/ml/route-risk/score` | **Real** XGBoost + real SHAP | Returns `modelVersion: route-risk-xgb-v1`, `shapValue: 14.5596`, `shapUnit: risk_points`, `direction`, per-feature `value` |
| `POST /api/ml/delivery-risk/score` | **Real** XGBoost, two heads | `delivery-risk-xgb-v1`, SHAP on both failure and delay |
| `GET /health` on the ML service | **Real** | `modelLoaded: true` for both models |
| Decision ladder | Real, and deterministic by design | `routeRisk ≥ 70` + safer route → REROUTE, etc. |
| Supply projection | Real deterministic arithmetic | stock ÷ consumption, delay-adjusted |

## What was NOT ML, despite the label

| Thing | Reality |
|---|---|
| Route risk **21 / 28 / 41** on Routes and Command Center | Seeded `Route.riskScore` column. Read straight out of the database by `/routes/candidates`. Not a model output in either mode. |
| "Rainfall +7%, Road Condition +6%, Historical Risk +5%, Terrain +3%, Traffic +2%" | Seeded `Route.topFactors`. A hand-authored ladder — 7/6/5/3/2 for A, 10/8/6/5/3 for B, 15/11/9/7/4 for C. **Not SHAP.** |
| Route `explanationText` | Seeded prose. |
| Incident classification and confidence | Gemini Vision when a photograph is attached; otherwise a seeded value. **There is no trained incident classifier in this repository.** |
| Everything in demo mode | Fixtures. The ML service is never called. |

## The disconnect that caused it

`scoreCorridor()` calls the model, gets real predictions with real SHAP, and writes them to the
`RiskPrediction` table — and then nothing reads them. `Route.riskScore` and `Route.topFactors`
are never updated, and `/routes/candidates` serves those seeded columns.

So the model ran, produced honest output, and the output was discarded before it reached a
screen. The live model scores Route A at **59** against the current corridor state while the
page shows the seeded **21**.

## What this phase changes

1. `/routes/candidates` serves the latest `RiskPrediction` when one exists — real score, real
   SHAP, real `modelVersion` — and says `source: "SEEDED"` when it is falling back.
2. The status rail reads the real `/api/ml/status` instead of guessing from the data source.
3. The provenance tag tells the truth in demo mode instead of claiming XGBoost.
4. A "Simulate Landslide" control runs the existing backend cascade rather than moving numbers
   in the browser.

Nothing here retrains a model, changes a threshold, or invents a classifier that does not exist.
