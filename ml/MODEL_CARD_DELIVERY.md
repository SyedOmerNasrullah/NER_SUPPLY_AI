# Model card — delivery-risk-xgb-v1

Two boosters on one feature contract, trained together and served together:

| head | model | answers |
|---|---|---|
| `failure` | `xgboost.XGBClassifier` (318 trees) | probability the delivery misses its required window |
| `delay` | `xgboost.XGBRegressor` (170 trees) | how many minutes late it will be, 0–1440 |

Version string `delivery-risk-xgb-v1` travels on every prediction and is stored on every
`RiskPrediction` row. A changed model is a new version, never an overwrite of this one.

---

## Intended use

Predicting the arrival risk of a single in-flight relief delivery on the Guwahati → Tawang
corridor, from its own telemetry and the risk score of the route it is on. It is the layer below
route risk and above supply projection in the cascade:

```
route risk (route-risk-xgb-v1) ─► delivery risk (this model) ─► adjusted ETA ─► stockout cover ─► Decision Engine
```

**Not** intended for: scheduling, routing, costing, or any decision about an individual driver.

---

## Inputs — the seven contract features

| feature | unit / encoding | source in production |
|---|---|---|
| `distanceRemainingKm` | km, great-circle | vehicle's last reported position → delivery destination |
| `currentSpeedKmh` | km/h | `Vehicle.speedKmh` |
| `routeRiskScore` | 0–100 | `Route.riskScore` of the assigned route |
| `weatherSeverity` | 0 normal, 1 moderate, 2 heavy, 3 severe | banded from the corridor `WeatherSnapshot` |
| `cargoPriority` | 0 LOW, 1 MEDIUM, 2 HIGH, 3 CRITICAL | `Delivery.priority` |
| `hourOfDay` | 0–23, India Standard Time | the moment of prediction |
| `dayOfWeek` | 0 = Monday … 6 = Sunday | the moment of prediction |

The contract lives in `app/delivery_domain.py` and is imported by both training and inference, so
the two can never disagree. Values outside the trained range are still scored and the response
says so in `warnings`.

Weather banding matches what the product already displays: `GET /api/weather` calls the corridor
"Heavy Rainfall" at 60 mm/24 h, and that is the same line where this feature becomes `HEAVY`.

---

## Training data — synthetic

**This dataset is synthetic.** It stands in for delivery telemetry the project does not have. No
metric below is evidence of real-world accuracy.

- 14 000 rows, seed `20241118`, SHA-256 `3e8ded97b140…`
- generator `training/generate_delivery_dataset.py`, formula `training/delivery_label_formula.py`
- failure rate 38.5 %
- delay label = journey time at the achievable speed (degraded by route risk and weather) minus
  the scheduled time, plus corridor stoppages that grow with the square of route risk and 25 %
  harder between 22:00 and 05:00; weekends run 8 % lighter
- observation noise on the delay: Normal(0, 8 min)
- **delay capped at 1440 minutes.** Past a day late the operational answer stops depending on the
  exact number, and the uncapped formula reaches 140 hours in the extreme corner
- failure label = Bernoulli on a logistic of (delay − slack), slack by priority:
  LOW 360, MEDIUM 240, HIGH 150, CRITICAL 90 minutes

Nothing in the generator is taken from the demo fixtures; none of the demo's expected numbers
(Route A = 21, NE-102 = 18 %, and so on) appears in it.

`app/` may not import the label formula, and a test enforces that — otherwise "prediction" could
be the formula evaluated directly.

---

## Split and metrics

Seed 7 · train 9 800 · validation 2 100 · test 2 100. Validation drives early stopping only; test
rows are never seen during fitting or model selection.

### Delay (minutes)

| | MAE | RMSE | R² |
|---|---|---|---|
| train | 25.59 | 55.31 | 0.966 |
| validation | 30.27 | 67.93 | 0.950 |
| **test** | **29.82** | **66.30** | **0.957** |
| *reference:* predict the training mean | 220.57 | 319.02 | −0.002 |
| *reference:* the noiseless formula (ceiling) | 5.98 | 7.63 | 0.999 |

The regressor is fitted on `log1p(minutes)` and inverted at inference: the target is heavily
skewed, and on raw minutes the same model scored MAE 39.0 / RMSE 62.76. The swap trades a little
tail accuracy (RMSE) for a third off the typical error (MAE), which is the one that matters for an
ETA. Monotonicity is unaffected — `log1p` is strictly increasing.

The gap to the noiseless ceiling (29.8 vs 6.0 MAE) is real and not hidden: the model has learned
the shape of the function well but not perfectly, mostly around the cap and at very low speeds.

### Failure (probability)

| | accuracy | precision | recall | F1 | ROC-AUC | avg precision | log loss | Brier |
|---|---|---|---|---|---|---|---|---|
| train | 0.913 | 0.905 | 0.865 | 0.884 | 0.969 | 0.961 | 0.218 | 0.065 |
| validation | 0.904 | 0.872 | 0.872 | 0.872 | 0.962 | 0.950 | 0.239 | 0.072 |
| **test** | **0.890** | **0.893** | **0.820** | **0.855** | **0.960** | **0.948** | **0.248** | **0.077** |
| *reference:* majority class (train) | 0.616 | — | — | — | — | — | — | — |
| *reference:* the true Bernoulli probability (ceiling) | 0.898 | 0.899 | 0.836 | 0.866 | 0.967 | 0.956 | 0.226 | 0.070 |

Test accuracy 0.890 against a ceiling of 0.898 — the outcome is genuinely random given the
features, so no model can do much better. `logloss` was the early-stopping metric rather than AUC
because the Decision Engine compares this probability against a fixed 0.85 threshold: it has to be
calibrated, not merely well ranked (test Brier 0.077).

---

## Monotone constraints

Shape constraints from domain knowledge, never a thumb on the values:

| feature | delay | failure |
|---|---|---|
| `distanceRemainingKm` | +1 | +1 |
| `currentSpeedKmh` | −1 | −1 |
| `routeRiskScore` | +1 | +1 |
| `weatherSeverity` | +1 | +1 |
| `cargoPriority` | 0 | +1 |
| `hourOfDay`, `dayOfWeek` | 0 | 0 |

Further, slower, riskier and wetter can only mean later. A tighter cargo window cannot make a
delivery *less* likely to miss it, but it does not change the physics of the journey, which is why
`cargoPriority` constrains the classifier only. Hour and day are left free: night and weekend
effects are real but not monotone in the encoding.

---

## Explanations (SHAP)

`shap.TreeExplainer`, tree-path-dependent, exact Shapley values, computed per prediction for both
heads. Additivity (`prediction = base + Σ shap`) is asserted on every test run.

Each factor carries `shapUnit`, because the two heads explain in different spaces:

- `topFactors` — what drove the failure probability, in **log-odds**
- `delayFactors` — what drove the delay, in **log1p-minutes**

`contributionPct` normalises the five displayed factors to 100 %, with the raw `shapValue` and a
`direction` alongside. A contribution percentage is a share of what is shown, never a share of the
prediction itself.

No language model produces any number here. Gemini narrates these figures through
`POST /api/ai/explain` (delta D46): numbers in, words out, with a guard that discards any reply
introducing a number that was not in the data, and a deterministic template whenever the model is
unavailable.

---

## Known limitations and risks

1. **Synthetic training data.** The headline limitation. The model has learned a function this
   project wrote, and its accuracy on real corridor telemetry is unknown.
2. **Straight-line distance.** `distanceRemainingKm` is great-circle, not road distance: the
   corridor geometry is schematic until OpenRouteService is integrated, so a road distance would
   look more precise without being more true.
3. **One weather snapshot per corridor.** A delivery spans many segments; the feature is the
   corridor's current weather, not the weather it will meet at hour six.
4. **The 1440-minute cap.** Predictions saturate at a day late, and the response warns when the
   raw value exceeded it.
5. **No traffic, driver, vehicle-condition or road-closure features.** A closure is visible to the
   model only through `routeRiskScore`.
6. **`AT_RISK` at p ≥ 0.5** is an application convention in the apply path, not a model output.
7. **The demo's numbers are not this model's numbers.** The deterministic demo replay is a
   separate, frozen story; where the two disagree, both are shown rather than reconciled.

---

## Provenance on every prediction

Every response and every persisted row carries: `modelVersion`, `source: ML_PREDICTION`,
`trainedOn: synthetic`, the dataset SHA-256, both artifact SHA-256s, and the explanation method.
The service refuses to start serving a model whose artifact hash does not match its metadata.


---

## Honest framing for judging

What may be claimed:

> "Two XGBoost models, validated on synthetic data the project generated: route risk (test
> MAE 2.1 points, R² 0.96) and delivery risk (delay MAE 30 min, R² 0.96; failure classification
> accuracy 0.89, ROC-AUC 0.96). SHAP explains every prediction. The demonstration replays a
> deterministic scenario; the models run beside it and are free to disagree."

What may **not** be claimed:

> ~~"96% accurate in real-world North Eastern logistics."~~

The models have never seen a real delivery. The metrics measure how well XGBoost recovered a
function this project wrote, against references that show both the floor (predicting the mean) and
the ceiling (the noiseless formula, and the true Bernoulli probability). Demo weather is a
simulation event, seeded conditions are synthetic operational data, and every screen in the
product labels which it is showing.
