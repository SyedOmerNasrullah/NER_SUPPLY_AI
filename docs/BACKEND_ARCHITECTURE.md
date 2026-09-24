# Backend architecture — Phases 4A, 4B, 5A, 5A.1, 5A.2

What exists today, and why it is shaped this way.

**Phase 4A** established the foundation: PostgreSQL, Prisma, an Express read API, a deterministic
seed. **Phase 4B** added authentication, the five write endpoints, and the demo cascade running
server-side against the database. Still no ML and no external services — Gemini,
OpenRouteService, Twilio and Socket.IO all belong to Phase 5+, and their credentials sit unused
in `api/.env`.

---

## 1. Shape

```
browser
  │  HTTP (CORS allowlist)
  ▼
React frontend            web/          VITE_DATA_SOURCE = demo | http
  │
  ▼
Express public API        api/          port 4000
  │
  ▼
PostgreSQL via Prisma                   Neon, pooled
  │
  ▼
(later phases, server-side only)
  FastAPI ML service · Gemini · OpenRouteService · Twilio · Socket.IO
```

**The browser talks to Express and nothing else.** Every later integration sits behind it, so no
credential ever reaches the bundle. This is not a stylistic preference: anything in a `VITE_`
variable is compiled into JavaScript that any visitor can read, which makes the frontend the one
place a key must never be.

Consequently `web/.env` holds only URLs and a mode flag, and `api/.env` holds the secrets.

---

## 2. Layout

```
api/
├─ prisma/
│  ├─ schema.prisma            contract §1 + the "required" deltas
│  ├─ migrations/              versioned, committed
│  ├─ seed.ts                  idempotent, deterministic
│  └─ seed-data/world.json     generated snapshot — see §5
├─ scripts/
│  ├─ export-demo-world.ts     regenerates world.json from web/src/data/demo
│  └─ verify.ts                row counts + baseline assertions
├─ src/
│  ├─ index.ts                 startup, DB check, graceful shutdown
│  ├─ app.ts                   Express wiring, /health
│  ├─ config/env.ts            validated once, fails loudly
│  ├─ lib/prisma.ts            one client, one pool
│  ├─ middleware/              error envelope, dev request log
│  ├─ routes/index.ts          the read API
│  └─ services/                summary and projection derivations
├─ .env                        gitignored — DATABASE_URL lives here
└─ .env.example                placeholders only, committed
```

---

## 3. The API is specified by the frontend, not the other way round

`web/src/data/http/index.ts` was written in Phase 2 and has been compiling, unused, ever since.
It names every path, method, timeout and error message. `web/src/domain/types.ts` declares every
response shape.

Those two files are the specification. The frontend is frozen and typed against them, so a field
renamed server-side is a blank panel client-side. `api/src/services/mappers.ts` is where the
contract is actually honoured — it is the only place database column names meet contract field
names, and it exists so that meeting happens once instead of in fifteen route handlers.

Two conventions in the mappers are load-bearing:

- **`null` becomes `undefined`.** Prisma returns null for an absent column; the contract uses
  optional properties, and several panels distinguish absent from zero. An absent
  `delayMinutes` means "running to plan"; a zero one means something measured zero.
- **Nothing is invented.** A field the database does not have is left off, and the frontend
  renders the reduced state it already documents for that case.

---

## 4. Error handling

Every failure is `{ "error": string }` with a real status, because that is exactly what the
frontend's `DataError` parses. Any other envelope becomes "Unexpected error" on screen.

Database errors never reach the browser. Prisma messages carry table names, column names and
sometimes failing values — a schema tour, handed to whoever asked. The client gets one sentence;
the server log gets everything.

`/health` is the single exception: it reports the database error text, because that endpoint
exists for whoever is operating the service. It answers **503** when the database is unreachable,
so a monitor sees a failure rather than a cheerful 200 from a process that cannot serve a single
request.

---

## 5. The seed does not invent a baseline

Phases 2–3F settled every number in the demo: Route A at 21%, NE-102's 5h05 ETA, Tawang's 2.1
days of medicine. Those values live in `web/src/data/demo/`.

Re-typing them into a seed file would create a second copy that drifts the first time either
side is edited — the exact failure the project's contract-delta discipline exists to prevent. So:

```
web/src/data/demo  ──(export-demo-world.ts)──►  prisma/seed-data/world.json  ──(seed.ts)──►  PostgreSQL
```

The exporter calls the demo adapter's own read methods and writes down what they return. Whatever
the frontend shows at baseline is, by construction, what lands in the database. `npm run verify`
then asserts the round trip: fifteen checks against the frozen values, run after every seed.

`world.json` is committed, so seeding works on a machine that has never built the frontend, and
the API never imports from `web/` at runtime.

### What is NOT in the demo world

Per-segment physical characteristics — slope, elevation, road condition, historical closure
counts — are the Phase 5 model's feature vector and the frontend never displays them, so the demo
does not carry them. The exporter derives them: elevation and slope are sampled from the
corridor's real elevation profile (the same one Route Intelligence draws), and the historical
counts distribute route A's recorded twelve-month totals across its segments in proportion to
baseline risk, so they sum back to the route-level figures the UI shows.

All of it is synthetic and labelled as such in `world.json`'s `meta` block.

### Idempotency

Upserts on stable ids, never a truncate-then-insert. A destructive seed is one mistyped
connection string away from wiping something real, and this seed runs against the same database
the demo runs on.

Upserts alone are not enough: a row written by an earlier snapshot under a different id sits
there forever. Three tables whose ids the seed *derives* — `InventoryItem`, `WeatherSnapshot`,
`RiskPrediction` — are therefore reconciled, deleting seed-owned ids outside the set just
written. Tables holding rows a running system creates are never pruned.

This is not hypothetical. An id-derivation bug in this file (splicing the distinguishing
characters out of a uuid) collapsed 45 inventory rows onto 3, and nothing noticed until
`verify.ts` counted for real — the seed's own summary had cheerfully reported 45, because it was
counting loop iterations rather than rows. It now counts rows.

"Seed-owned" has to be exact. `RiskPrediction` is shared: the seed writes baseline rows
(`modelVersion: 'seed-baseline-no-model'`) and the Phase 5A ML path logs its own scores into the
same table. The prune originally filtered only on entity, so re-seeding in Phase 5A.2 deleted every
ML-scored prediction along with the stale baseline rows. The prune is now scoped to the seed's
`modelVersion`, the ML log was regenerated (`npm run ml:report` reproduces the Phase 5A figures
exactly), and a re-seed since has left the ML rows in place.

---

## 6. Authentication

`POST /api/auth/login` → `{ token, user }`. bcrypt (cost 10) for passwords, JWT (12h) for
sessions, both from `services/auth.ts`. `GET /api/auth/me` re-reads the user, so a token minted
before a role change does not keep the old one.

Three things worth stating plainly:

- **No hash ever reaches the wire.** Responses are built by `toUser(...)`, a mapper with no such
  field, rather than by spreading a Prisma row. The shape makes the leak impossible instead of
  relying on someone remembering to delete a key.
- **Login is constant-ish time.** An unknown address is still compared against a dummy hash, so
  response timing does not reveal which addresses exist. "No such user" and "wrong password" are
  the same 401 with the same sentence.
- **Eleven of the fifteen seeded users cannot sign in at all.** They are staff records, so their
  `passwordHash` is a marker that is not a bcrypt hash of anything — `compare` cannot match it
  under any input. Not a password nobody knows: no password.

Authorisation is `requireRole(...)`, applied per route from contract §4's matrix:

| Action | Roles |
|---|---|
| create delivery | ADMIN, LOGISTICS_OFFICER |
| report incident | ADMIN, LOGISTICS_OFFICER, FIELD_OFFICER |
| reroute | ADMIN, LOGISTICS_OFFICER |
| simulate rainfall | ADMIN, LOGISTICS_OFFICER |
| reset demo | ADMIN |

The frontend hides tabs and buttons a role cannot use. That is a courtesy, not a boundary —
`app/modules.ts` says so itself — and these guards are the API keeping that promise. Reads are
open in Phase 4B; every write requires a valid token and the right role.

---

## 7. The write path

All five writes validate with zod before touching Prisma — not for type safety, which TypeScript
already pretends to give, but so a malformed request is a 400 with a sentence rather than a 500
from the database.

Each of the three state-changing operations runs in **one transaction** (`CASCADE_TX`, 60s
budget). A cascade that updated the weather and the segments and then failed on the supply
projection would leave heavy rainfall over a corridor whose medicine is still comfortable —
internally contradictory, hard to notice, embarrassing to present.

### Where the numbers come from

**Simulate** replays the frozen demo's own recorded cascade output. `export-demo-world.ts` runs
the frozen implementation and records the result into `world.afterRain`; the API applies that
delta. The alternative — reimplementing the cascade against Prisma rows — is how the two halves
of this project would start disagreeing about whether Route A scores 87 or 86.

**Reroute** is implemented properly, because it must work for any candidate rather than the one
the demo scripts. Its formulas are the frozen `applyReroute` and `reprojectMedicineCover`, rule
for rule: the delivery inherits the ETA and risk of the road it is actually on, delay is measured
against what was required, and the destination's cover is re-derived from the resulting delay.

**The decision engine** (`services/decision.ts`) is the specified first-match ladder — risk ≥ 70
with a candidate ≥ 15 points safer → REROUTE; cover < 48h → PRE_POSITION; failure ≥ 0.85 → ALERT;
else NONE. Deterministic and readable, which is the entire reason it is not a language model.
`confidence` is always the confidence of the *prediction* behind the matched branch, never a
number invented for the decision.

### Reset

Two different operations, deliberately not conflated:

- **restore** demo-owned *state* — weather, risk scores, ETAs, projections — back to the seeded
  values. These rows always existed; only their values moved. Only rows that actually differ are
  written (see Performance below).
- **delete** rows a demonstration *created*, identified by `demoGenerated`. Never by "created
  recently", never by truncating. A delivery created through `POST /api/deliveries` is an
  operational record and does **not** carry the flag, so it survives a reset.

### Performance

The cascade and the reset are network-bound, not algorithmic. One round trip to Neon us-east-2
costs roughly 500 ms from here, and a transaction's queries are serialised over one connection:

| | first version | now |
|---|---|---|
| simulate | 24 s | ~10 s |
| reset | 33 s | ~7.5 s |

Two fixes got it there — restoring only rows that differ from baseline (the cascade touches five
or six, so writing back the other eighty-five was pure waste), and re-deciding only deliveries
the cascade actually moved. What remains is latency, and the honest remedy is a closer database:
**run PostgreSQL locally for the live demo.** Prisma's default 5 s transaction budget is also far
too small here — it expires mid-cascade and reports "Transaction not found", which reads like
corruption rather than slowness.

---

## 8. The ML layer (Phase 5A)

```
React ──► Express ──► FastAPI (ml/, 127.0.0.1:8000) ──► XGBoost ──► SHAP
             │
             └──► PostgreSQL  RiskPrediction, provenance = ML_PREDICTION
```

**Only Express talks to the model.** The ML service binds to loopback, sends no CORS headers, has
its interactive docs disabled, and requires `X-Internal-Token` (compared in constant time) on every
prediction. The token lives in `api/.env` and `ml/.env`, never in a `VITE_` variable.

**`ML_MODE` is an explicit switch.** `demo` (default): Express never contacts FastAPI and the
`/api/ml/score` endpoint answers 409. `live`: Express may call it. Any other value stops the
process — a typo must not silently turn live ML on or off in front of an audience.

**`services/mlClient.ts`** is the only code that calls FastAPI. Every response is validated with
zod before anything is persisted — a response that parsed as JSON but carried `riskScore: "high"`
would otherwise land in PostgreSQL as a prediction. Failures are typed and mapped to statuses in
`errorHandler`: DISABLED 409, UNAVAILABLE / TIMEOUT 503, REJECTED / INVALID_RESPONSE 502. Python
detail goes to the server log only.

**`services/routeRiskFeatures.ts`** is the one place database rows become the model's twelve
inputs. Segments use their own columns; routes use their `profile` rollup (delta D12), with
`previousClosureFrequencyPct = previousClosures / 52 × 100`. Nothing is defaulted — an entity
missing an input is skipped with a reason.

**Scoring does not replace the displayed scores.** `Route.riskScore` and
`RouteSegment.lastRiskScore` stay on the frozen demo values. ML predictions go to the append-only
log, and `GET /api/ml/route-risk/comparison` sets them side by side — see
`docs/ML_REGRESSION_5A.md`. Reset leaves ML predictions alone: they are genuine model output, not
demo state.

Thresholds: new backend code uses `src/domain/riskThresholds.ts`. The Python service holds its own
copy, and its test suite reads `web/src/domain/thresholds.ts` and fails on drift.

---

## 8a. Incidents — reporting at a place (Phase 5A.1)

### Contract

`POST /api/incidents` — multipart form, bearer token; ADMIN, LOGISTICS_OFFICER, FIELD_OFFICER.

| Field | Rule |
|---|---|
| `type` | `LANDSLIDE` · `FLOOD` · `DEBRIS` · `DAMAGED_ROAD` · `BLOCKED_ROAD` · `NORMAL` |
| `severity` | `LOW` · `MEDIUM` · `HIGH` · `CRITICAL` |
| `lat` | required, −90 … 90 |
| `lng` | required, −180 … 180 |
| `description` | optional, ≤ 2000 chars |
| `segmentId` | optional; must name an existing segment, else 400 |
| `photo` | optional file, accepted and discarded (delta D28) |

`201 { incident, cascadeTriggered, segmentMatch }` where `segmentMatch` is
`{ segmentId, code, name, distanceKm }` or `null` (delta D36). Invalid input is 400 with a
sentence; no token 401; a DISTRICT_OFFICER 403. `GET /api/incidents` returns every incident,
newest first, with `segmentName` joined in a single second query (no N+1).

**The submitted latitude and longitude are the incident's location, stored verbatim.** Nothing
moves them — not segment matching, not the cascade.

### Incident → segment association (MVP)

`src/domain/geo.ts`. Each `RouteSegment` is the straight line between its stored start and end
points — the only geometry the schema holds. The incident's distance to each line is measured in
a local equirectangular projection (projecting onto the line and clamping to its ends), and the
nearest segment is associated **only if it is within 5 km**. Otherwise `segmentId` is null.

The threshold is the honest part. The earlier version snapped to the nearest segment midpoint at
any distance, so a report from Aizawl would have been filed against the Guwahati–Tawang corridor
and — at HIGH severity — re-scored a road 350 km away. Now a HIGH or CRITICAL report runs the
cascade **only when it matched a segment**.

Known limitation: roads are not straight. A mountain road can run several kilometres from the
chord between its endpoints, which is why the threshold is 5 km and not tighter; a point that
looks "on the road" at low zoom can fall just outside it (the Phase 5A.1 browser test landed at
5.02 km and was correctly stored without a segment). Real road geometry from OpenRouteService —
a later phase — replaces the chords. The demo adapter uses the identical rule
(`web/src/domain/geo.ts`), so both data sources associate the same way.

### How a new marker reaches the map

`POST` → the data layer clears its request cache and bumps the cascade version → every mounted
`useIncidents()` refetches → the map draws each incident at its stored `[lat, lng]`, keyed by id.
There is no optimistic marker, so nothing can disagree with the database and nothing needs
de-duplicating after the refetch. Incident Center, the Live Map and the Command Center all read
the same resource.

---

## 8b. Route candidates — three routes, three lines (Phase 5A.2)

Each candidate is its own `Route` row with its own `geometry` (`[lat, lng]`, 91 points), stated
`distanceKm` / `etaMinutes`, risk, SHAP factors, profile, elevation profile and `segmentIds`. All
of it is exported from the demo adapter into `world.json` and seeded, so demo mode and API mode draw
the same three lines; in API mode every one of them comes from `POST /api/routes/candidates`.

| Route | Geometry (deterministic, smoothed through real towns) | Segments travelled |
|---|---|---|
| A — NH-15 / NH-13 via Bomdila | the 16 corridor waypoints | all 15 |
| B — Tezpur bypass via Kalaktang | Mangaldoi → Udalguri → Bhairabkunda → Kalaktang → Shergaon → Rupa → Bomdila → Sela Tunnel → Tawang | 001–002, 011–015 |
| C — Eastern approach via Seppa | Dhekiajuli → Tezpur → Balipara → Seijosa → Seppa → Dirang → Jang → Tawang | 001–003, 006–008, 013–015 |

B and C used to be A's line offset sideways. Near both ends the copies overlapped A, and the frontend
had four more faults stacked on top: it drew the routes in a fixed order, so C's click target
covered the others; `FitBounds` fitted once and never again; pages framed all three routes rather
than the one selected; and the map's pan bounds (4° wide) were narrower than the visible map at the
zoom a route is framed at, so Leaflet pinned the centre and no fit could move it. All five are fixed
in the frontend; the backend change is only that `segmentIds` now reaches the wire (delta D39).

How `segmentIds` is computed: a segment belongs to a route when its midpoint is within 3 km of the
route's line, ordered by the first leg of the route that passes it. One function, used by the demo
adapter at runtime and by the exporter for the seed. The drawn lines are schematic; OpenRouteService
geometry replaces them in the external-integration phase, at which point the tolerance should go
back to the contract's 5 km.

---

## 9. What is still not built

`POST` endpoints for login, delivery creation, reroute, incident submission, simulate-rain and
reset are **registered and answer 501** with a sentence naming the phase they arrive in.

That is deliberate. Leaving them unregistered produces "No route matches POST /api/…", which
reads like a routing mistake; answering 501 says what is true — the endpoint is planned, the
phase has not arrived, and nothing happened. It is also the one answer that cannot be mistaken
for success.

The demo adapter still owns the cascade. `VITE_DATA_SOURCE=demo` remains the default and the
whole product works exactly as it did at the end of Phase 3F.

---

## 10. Commands

```bash
# one-time
cd api && npm install
cp .env.example .env          # then fill in DATABASE_URL

npm run prisma:validate       # schema is well-formed
npm run prisma:generate       # regenerate the client
npm run migrate               # create + apply a migration (dev)
npm run migrate:deploy        # apply existing migrations (CI / production)
npm run seed                  # deterministic, safe to rerun
npm run verify                # row counts + baseline assertions
npm run dev                   # http://localhost:4000
npm run export:world          # regenerate seed-data/world.json from the frontend

curl http://localhost:4000/health
```

The database is reproducible from **schema + migrations + seed**, in that order, on an empty
database.


---

## The intelligence cascade (Phase 6B)

Each layer consumes the layer above. Nothing in it is a disconnected demo calculation.

```
weather / incident            WeatherSnapshot, Incident
        |
        v
route segment risk            RouteSegment.lastRiskScore
        |
        v
route risk                    route-risk-xgb-v1     ──► RiskPrediction (entityType ROUTE)
        |                     features from Route.profile + corridor weather
        v
delivery risk                 delivery-risk-xgb-v1  ──► RiskPrediction (entityType DELIVERY)
        |                     features from Delivery + Vehicle + Route.riskScore + weather
        v
predicted delay / adjusted ETA    currentEta + predictedDelayMinutes
        |
        v
supply stockout               reprojectMedicineCover(): seeded baseline - delay - consumption drag
        |
        v
decision engine               decide(): 70 / 15-point margin / 48 h / 0.85, first match wins
        |
        v
recommendation                AIRecommendation
        |
        v
alert -> notification         Alert, Notification (SMS via Twilio, Phase 6A)
```

Two paths reach the same product fields, and the difference is deliberate:

| path | who writes the numbers | when |
|---|---|---|
| `POST /api/demo/simulate-rain` | the frozen `world.afterRain` replay | the demonstration |
| `POST /api/ml/delivery-risk/score {"apply": true}` | the models | an ML-driven run |

Both end in the same Decision Engine, unchanged. The browser never reaches FastAPI: Express holds
`ML_INTERNAL_TOKEN` and calls `/internal/predict-route-risk` and `/internal/predict-delivery-risk`
on loopback.

Observed end to end on 2026-09-17, heavy-rain scenario, NE-102:

```
segment SEG-010 87 -> Route A 87 -> delivery ML: p(fail) 0.984, delay 339 min
  -> ETA 12:14 -> 17:53 -> Tawang medicine cover 32 h -> 29 h -> decision REROUTE (confidence 0.87)
POST /api/demo/reset -> 0.18 / 0 min / 09:59 / 51 h / routes 21-28-41
```


---

## The intelligence layers (Phase 6C)

```
                      WEATHER / INCIDENT
                              |
                       SEGMENT RISK                 RouteSegment.lastRiskScore
                              |
                      ROUTE RISK ML                 route-risk-xgb-v1, per candidate
                   /          |                       Route A       Route B       Route C    each scored from its OWN features
                   \          |          /
                     ROUTE COMPARISON               GET /api/routes/comparison
                              |                     delta vs assigned, 15-point margin
                     DELIVERY RISK ML               delivery-risk-xgb-v1
                              |                     failure probability + delay
                     DELAY / ADJUSTED ETA           currentEta + predictedDelayMinutes
                              |
                     SUPPLY STOCKOUT                projectStock(): stock ÷ consumption,
                              |                     resupply, 48 h threshold crossing
                     DECISION ENGINE                decide(): 70 / 15 / 48 h / 0.85
                   /          |                       REROUTE   PRE_POSITION    ALERT
```

Two side paths, both evidence-only:

```
INCIDENT IMAGE -> Gemini Vision -> cvDetectedClass / cvConfidence / cvEstimatedBlockage
                                   (beside the reporter's own classification, never over it)

ML STRUCTURED FACTORS -> Gemini -> natural-language explanation
                                   (numbers in, words out; template fallback; guard rejects
                                    any number that was not in the data)
```

### Endpoints added in 6C

| endpoint | who | what |
|---|---|---|
| `GET /api/routes/comparison` | open read | candidate risks, deltas, safer-route verdict |
| `POST /api/ml/delivery-risk/score` | ADMIN, LOGISTICS | score live deliveries; `apply` writes through |
| `POST /api/ml/delivery-risk/preview` | ADMIN, LOGISTICS | what-if on another route; persists nothing |
| `POST /api/deliveries/:id/reroute` | ADMIN, LOGISTICS | `rescore: true` re-runs the model after the move |
| `POST /api/ai/explain` | any signed-in role | figures in, one sentence out, provenance on both |

### Two ways the world moves, kept apart

| path | who writes the numbers | when |
|---|---|---|
| `simulate-rain`, or a HIGH/CRITICAL incident on the corridor | the frozen replay | the demonstration |
| `delivery-risk/score {"apply": true}`, `reroute {"rescore": true}` | the models | an ML-driven run |

Both end in the same Decision Engine. `POST /api/demo/reset` restores the baseline from either.
