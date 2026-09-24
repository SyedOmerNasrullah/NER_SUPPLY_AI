# Contract deltas

Everything the rebuilt frontend needs that `PROJECT_CONTRACT.md` does not currently specify.

**This file is the antidote to the failure that killed the previous build.** The rule:

> A delta is recorded here **the moment it is discovered**, and merged into
> `PROJECT_CONTRACT.md` **before Phase 4 writes a line of backend code**. Nothing is added to
> `web/src/domain/types.ts` without an entry here first. No silent additions, ever.

Status values: **OPEN** (needs a contract amendment) · **MERGED** (contract updated) ·
**REJECTED** (decided against; kept for the record).

---

## Freeze classification (Phase 3E)

The frontend is frozen. Every delta below is now sorted into exactly two buckets, so Phase 4 can
be planned against a fixed list rather than a growing one.

### A. REQUIRED FOR BACKEND INTEGRATION

The frontend renders these today from the demo adapter. If the API does not return them, the
corresponding panel has no honest content and must be removed rather than faked. **These block
integration.**

| # | Delta | What it needs | Contract § |
|---|---|---|---|
| D3 | `GET /api/warehouses` | new endpoint | §4 |
| D4 | `GET /api/weather` | new endpoint | §4 |
| D5 | Place names on `Delivery` | two fields on an existing response | §3 |
| D6 | Nearest place on `Vehicle` | one field on an existing response | §3 |
| D7 | Command Center headline aggregates | new endpoint or computed fields | §4 |
| D11 | `GET /api/movements` | new endpoint | §4 |
| D14 | `POST /api/deliveries/:id/reroute` | **the only write the product performs** | §4 |
| D15 | `Delivery.cargoUnits`, `Delivery.destDistrictId` | two fields; `destDistrictId` is what joins deliveries to supply lines | §3 |
| D16 | `GET /api/notifications` | new endpoint | §4 |
| D17 | `DistrictDetailResponse.projections` | the stockout arithmetic the Supply page shows its working for | §4 |
| D18 | `Incident.segmentId`, `Alert.relatedType`/`relatedId` | three fields; without them the causal chain cannot be joined | §3 |

D14, D15 and D18 are the load-bearing three: they are what make the cascade a chain of joined
records rather than four pages that happen to agree.

### B. OPTIONAL / FUTURE

Each of these degrades gracefully — the UI already renders a truthful reduced state when the
field is absent. **None block integration.**

| # | Delta | Behaviour if absent |
|---|---|---|
| D1 | HIGH gets its own risk colour | palette decision, frontend-only |
| D2 | Districts beyond the corridor | Supply covers fewer districts |
| D10 | Notification delivery state on `Alert` | the "SMS sent" chip is not rendered |
| D12 | `RouteCandidate.profile` | terrain profile panel hidden |
| D13 | `RouteCandidate.elevationProfile` | elevation graphic hidden |
| D20 | `AnalyticsSummaryResponse.history` | "no history recorded" instead of a chart |
| D21 | `DecisionTrace` on detail responses | the decision ladder collapses to its outcome |
| D22 | `Vehicle.anomaly` | no anomaly panel; markers still colour from the shared threshold |

### Already settled — no Phase 4 work

**D8** (SHAP for every candidate) · **D9** (session persistence) · **D19** (URL selection state) ·
**D23** (`getDemoAccounts` is deliberately not an endpoint) · **D24** (`District.id` stays
colon-free) · **D25** ("now" is a data-layer concern).

---

## D1 — HIGH gets its own risk colour · OPEN · §2

Contract §2 says HIGH and MEDIUM both render `signal-amber` because "the palette only has 3
accent colors for 4 risk levels". The Phase 2 palette has four risk colours, so HIGH renders
`#E8710A` and MEDIUM renders `#F0A32B`.

**Bucket boundaries are unchanged.** Only the colour assignment differs, and the enum values
are untouched. Amend §2's UI note.

**Impact:** presentation only. No API change.

---

## D2 — Additional districts beyond the corridor · OPEN · §7 seed

The visual reference shows Supply Intelligence covering **Kohima, Aizawl, Itanagar** alongside
Tawang — a pan-North-East picture, not one road. The backend seed has 10 corridor districts.

The demo layer adds five: Kohima (Nagaland), Aizawl (Mizoram), Itanagar (Arunachal Pradesh),
Imphal West (Manipur), East Khasi Hills (Meghalaya), as district ids 11–15 on the existing
scheme.

**Impact:** purely additive to the seed. No schema change; `District` is unchanged. Phase 4
extends `seed/corridor.ts`.

---

## D3 — `GET /api/warehouses` · OPEN · §4

The map draws warehouses, and Supply Intelligence's pre-positioning comparison needs their
coordinates, but §4 exposes no warehouse endpoint. The `warehouses` table already exists in §1.

Proposed: `GET /api/warehouses → { warehouses: Warehouse[] }` where
`Warehouse = { id, name, lat, lng }`.

**Impact:** one new read-only endpoint over an existing table.

---

## D4 — `GET /api/weather` · OPEN · §4

The Command Center hero band shows current corridor conditions ("Moderate Rainfall", rainfall
1h/24h, wind, visibility) and must show that they changed after the simulate control ran. §1
has `weather_snapshots`; §4 exposes no read endpoint.

Proposed: `GET /api/weather → { weather: WeatherConditions }` where
`WeatherConditions = { label, rainfall1hMm, rainfall24hMm, windKmh, visibilityKm, simulated }`.

`simulated: boolean` is the important field — it is what lets the UI label the conditions as a
simulation event rather than a measurement.

**Impact:** one new read-only endpoint; `simulated` may need a column or may be derivable from
the snapshot source.

---

## D5 — Human-readable place names on `Delivery` · OPEN · §3

`Delivery` carries origin/destination as coordinates only. Every screen that lists a delivery
shows "Guwahati → Tawang District Hospital", and reverse-geocoding on the client is not
acceptable for a demo that must work offline.

Proposed: optional `originName?: string` and `destName?: string` on `Delivery`.

**Impact:** two nullable columns, or a join to `districts`/`warehouses`.

---

## D6 — Nearest place on `Vehicle` · OPEN · §3

The "Recent Movements" panel in the visual reference reads "V-201 · NE-102 · Near Bhalukpong ·
On Route". The nearest corridor town is a server-side haversine lookup against the 16 seeded
waypoints.

Proposed: optional `nearestPlace?: string` on `Vehicle`, derived server-side.

**Impact:** derived field, no storage.

---

## D7 — Command Center headline aggregates · OPEN · §4

The top strip shows six figures with deltas: active deliveries, at-risk deliveries, road
blockages, critical supply alerts, field officers active/total, average delay today. Every one
is computable from existing endpoints, but doing so on the client means six list fetches to
render six numbers, and the deltas ("↑8%", "↓23%") need yesterday's values, which the client
does not have.

Proposed: `GET /api/summary → { activeDeliveries, atRiskDeliveries, roadBlockages,
criticalSupplyAlerts, fieldOfficersActive, fieldOfficersTotal, averageDelayMinutes }`, each
with a `deltaPct` against the previous day.

**Impact:** one aggregate endpoint. Alternative — compute client-side and drop the deltas.
Decide in Phase 4.

**Phase 3A update.** The Command Center is built against this endpoint, so the shape is now
fixed in `web/src/domain/types.ts` as `OperationalSummary`:

```ts
{
  activeDeliveries:     { value, deltaPct, atRisk }
  atRiskDeliveries:     { value, deltaPct, critical }
  roadBlockages:        { value, major, minor }
  criticalSupplyAlerts: { value, districts }
  fieldOfficers:        { active, total }
  averageDelayMinutes:  { value, deltaPct }
}
```

Served as `GET /api/summary → { summary: OperationalSummary }`.

---

## D8 — SHAP factors for every candidate · **RESOLVED** · §4, §5

§4 says the backend marks the lowest-risk candidate `isRecommended`, but said nothing about
which candidates carry `topFactors`.

**Decision (Phase 3C): every candidate returned to the operator carries its own SHAP breakdown
and its own explanation. Not just the recommended one.**

The reason is a product one, not a convenience. Route Intelligence lets the operator select
Route A, B or C and asks *"why is this route risky?"* about whichever is selected. A contract
where only the recommendation is explainable makes two of the three selections dead ends, and
it makes the most important question un-askable: the operator is on Route A at 87% and needs to
know **why that one** is bad — the factor breakdown for Route B does not answer it.

Consequences the backend must accept:

- `RouteCandidate.topFactors` is **never empty** for a scored candidate; same for
  `explanationText`. This is now written into `web/src/domain/types.ts` as a doc comment on the
  field, so it cannot be quietly dropped.
- `/internal/predict-risk` is called once **per candidate**, not once per request. With three
  candidates that is three model calls plus three SHAP computations. At demo scale this is
  cheap; at real scale it is the obvious thing to batch, and the endpoint should take a list.
- The narration is the expensive part, not the SHAP. If LLM latency becomes a problem, the
  correct trade is to return factors for all candidates and narrate lazily — **never** to drop
  factors for the non-recommended ones.

Rejected alternative: return factors only for the recommended candidate and grey out the others'
"why" panel. That would design the frontend around a backend convenience and remove the single
most defensible thing this product does.

---

## D9 — Session persistence · MERGED (frontend-only) · §4

The previous build held the JWT in memory only, so a browser refresh signed the presenter out
mid-demo. Phase 2 persists the session to `sessionStorage`.

`GET /api/auth/me` already exists in §4 and was simply unused. Phase 6 will call it on boot to
re-validate the restored token rather than trusting the stored user object.

**Impact:** none on the API. Recorded because it reverses a documented decision.

---

## D10 — Notification delivery state on `Alert` · OPEN · §3

`Alert.notifiedViaTwilio: boolean` collapses three distinct states the UI wants to show:
queued, delivered, and **rejected by the provider**. Twilio's trial tier rejects every send, and
the runbook's §5 answer depends on the interface reporting that failure honestly rather than
showing nothing.

Proposed: keep `notifiedViaTwilio` for compatibility and add optional
`notificationStatus?: 'NONE' | 'QUEUED' | 'SENT' | 'FAILED'`. The `notifications` table already
carries a `status` column.

**Impact:** one optional field, derived from an existing table.

**Superseded by D16**, which exposes the `notifications` table directly and carries the failure reason as well as the status.

---

## D11 — `GET /api/movements` · OPEN · §4 (raised in Phase 3A)

The Command Center's "Recent Movements" panel needs the fleet's latest position reports as a
feed, not as the full vehicle list: vehicle code, the delivery it is carrying, the nearest
corridor town, a running/delayed status, and how far behind it is.

Proposed: `GET /api/movements → { movements: VehicleMovement[] }` where

```ts
VehicleMovement = {
  id, vehicleCode, deliveryCode, place,
  status: 'ON_ROUTE' | 'DELAYED' | 'STOPPED',
  delayMinutes?: number
}
```

`place` is D6's nearest-waypoint lookup; `status` is derivable from the delivery's own status
and predicted delay. Everything here exists in §1 already — this is a projection, not new state.

**Impact:** one read-only endpoint. In Phase 6 the same shape should also arrive over Socket.IO
as `vehicle:update`, which is still unspecified (see below).

---

## D12 — `RouteCandidate.profile` · OPEN · §3 (raised in Phase 3B)

Route Intelligence has to explain *why* a corridor scores what it does. Every input already
exists per-segment in §1's `route_segments` — `roadCondition`, `trafficLevel`,
`terrainSlopeDeg`, `elevationM`, `historicalLandslides`, `historicalFloods`,
`previousClosureFrequencyPct` — but `RouteCandidate` exposes none of it, so the page would have
to fetch fifteen segments and roll them up on the client.

Proposed: an optional `profile` on `RouteCandidate`:

```ts
RouteProfile = {
  roadCondition: 'GOOD' | 'FAIR' | 'POOR',   // the WORST segment, not the mean
  trafficLevel: number,                       // 0-3, mean
  maxSlopeDeg: number,
  maxElevationM: number,
  weatherSeverity: 'CLEAR' | 'MODERATE' | 'HEAVY' | 'SEVERE',
  history: { previousClosures, landslides, floods, avgClosureHours }
}
```

Two decisions Phase 4 must honour, because the UI is built on them:
- `roadCondition` is the **worst** segment on the route. Averaging one POOR stretch into
  fourteen GOOD ones hides the thing the operator needs.
- `history` counts are **recent recorded events** (rolling 12 months) on the segments the route
  covers, not the lifetime totals stored per segment.

**Impact:** an aggregation over existing columns. No schema change.

---

## D13 — `RouteCandidate.elevationProfile` · OPEN · §3 (raised in Phase 3B)

The terrain visualisation needs the corridor's height profile:

```ts
ElevationPoint = { distanceKm: number, elevationM: number, slopeDeg: number, place?: string }
```

`slopeDeg` is the **average gradient of the leg arriving at that point** — deliberately a
different measure from `RouteProfile.maxSlopeDeg`, which is the peak local gradient held per
segment. The UI labels them "steepest section (avg)" and "peak gradient" so they cannot be
read as contradicting each other; Phase 4 must keep that distinction.

`distanceKm` must be **road distance**, not straight-line. The demo layer scales its
straight-line samples to the candidate's own `distanceKm`; if the API returns straight-line
positions, the chart will contradict the distance shown in the comparison table.

**Impact:** derived from segment geometry and elevation, both already stored.

---

## D14 — `POST /api/deliveries/:id/reroute` · OPEN · §4 (raised in Phase 3B)

Route Intelligence and Delivery Intelligence both offer **Reroute delivery**. There is no
endpoint for accepting a recommendation, so the seam is typed in `data/source.ts` as
`rerouteDelivery({ deliveryId, routeId })` and implemented for real in the demo adapter — the
UI does not fake a success state.

Proposed: `POST /api/deliveries/:id/reroute { routeId } → { delivery, recommendation? }`.

Behaviour the demo implements and Phase 4 should match:
- reassign `assignedRouteId`, adopt the new route's ETA, re-derive `expectedDelayMinutes` and
  `failureProbability`, update `status`;
- **retire the REROUTE recommendation** — it has been acted on;
- **keep any PRE_POSITION recommendation.** The supply shortfall was caused by delay already
  incurred; rerouting does not put the stock back. This is the single most important behaviour
  in this endpoint and the easiest to get wrong.

Errors: `404` unknown delivery, `409` when `routeId` is not a current candidate.

**Impact:** one new endpoint that re-runs the decision engine.

---

## D15 — `Delivery.cargoUnits` and `Delivery.destDistrictId` · OPEN · §3 (raised in Phase 3B)

Delivery Intelligence shows the cargo quantity, and its supply-impact panel needs the district
the destination sits in. Deriving the district by reverse-geocoding the destination coordinate
on the client is fragile and would not survive a destination that is not a district HQ.

Proposed: optional `cargoUnits?: number` and `destDistrictId?: string` on `Delivery`.

**Impact:** one column, one nullable foreign key.

---

## D16 — `GET /api/notifications` · OPEN · §4 (raised in Phase 3B)

`Alert.notifiedViaTwilio: boolean` cannot express what the delivery page must show: which
officer was contacted, on which channel, and whether the provider accepted it. §1 already has a
`notifications` table with exactly this.

Proposed: `GET /api/notifications → { notifications: NotificationRecord[] }`:

```ts
NotificationRecord = {
  id, alertId, alertTitle,
  channel: 'SMS' | 'CALL' | 'DASHBOARD',
  status: 'QUEUED' | 'SENT' | 'DELIVERED' | 'FAILED',
  recipientName, recipientRole, recipientPhone?,
  failureReason?, sentAt, relatedId?
}
```

`failureReason` is required for the demo to stay honest: Twilio's trial tier rejects the voice
call, and the UI shows that rejection in full rather than hiding the row. Supersedes the
narrower proposal in D10.

**Impact:** one read-only endpoint over an existing table.

---

## D17 — `DistrictDetailResponse.projections` · OPEN · §4 (raised in Phase 3C)

`StockLine.predictedStockoutHours` gives the answer but not the reasoning. Supply Intelligence
has to show the reasoning, because that panel carries the product's core argument: a delayed
truck becomes a hospital running out of medicine. Without the baseline and the drag the page can
only assert the 32 hours; with them it can draw the subtraction.

Proposed: `GET /api/districts/:id → { district, recommendation?, projections? }` where

```ts
SupplyProjection = {
  category, currentStock, dailyConsumption,
  baselineStockoutHours,   // if the inbound delivery lands on schedule
  adjustedStockoutHours,   // what predictedStockoutHours currently says
  disruptionHours,         // baseline - adjusted, i.e. what the delay cost
  inboundDeliveryCode?, inboundDeliveryId?, inboundDelayMinutes?
}
```

`disruptionHours` must be derived by **subtraction**, not recomputed independently — otherwise
it can disagree with the figure the rest of the product renders for the same district.

**Impact:** derived from data already held. No schema change.

---

## D18 — `Incident.segmentId` and `Alert.relatedType` / `relatedId` · OPEN · §3 (raised in Phase 3C)

Both columns exist in §1 (`incidents.segmentId`, `alerts.relatedEntityId`) and neither is
exposed. Without them the Incident Center would have to infer an incident's segment from its
coordinates, and match its alerts by reading their prose.

Proposed:
- `Incident.segmentId?: string` and a convenience `segmentName?: string`;
- `Alert.relatedType?: 'DELIVERY' | 'DISTRICT' | 'SEGMENT' | 'INCIDENT'` and
  `Alert.relatedId?: string`.

**Impact:** exposing existing columns plus one join for the label.

---

## D19 — Selection state lives in the URL · **RESOLVED** (frontend-only)

Phase 3B left route selection as component state, so selecting Route C and navigating away
silently reset it.

**Decision (Phase 3C): every page's primary selection is a query parameter.**

| Page | Parameter |
|---|---|
| Route Intelligence | `/routes?route=<routeId>` |
| Supply Intelligence | `/supply?line=<districtId>:<category>` |
| Incident Center | `/incidents?incident=<incidentId>` |
| Delivery Intelligence | `/deliveries/:code` (already a path parameter) |

Three reasons, in order of weight: another page can link straight to a specific route, supply
line or incident — which is what makes the Incident Center's cascade stages navigable rather
than decorative; the browser back button behaves; and it needs no global state machinery, which
for one string per page would be all cost and no benefit.

Written with `replace: true` so repeatedly changing a selection does not bury the previous page
under history entries. An unrecognised or absent id falls through to the page's own default, so
a stale link degrades instead of breaking.

**Impact:** none on the API.

---

## D20 — `AnalyticsSummaryResponse.history` · OPEN · §4 (raised in Phase 3D)

Analytics needs a real series to chart. §4's summary returns current aggregates only, so without
this the page can either show a snapshot or invent a time series — and inventing one is the
fastest way to lose a judge's trust.

Proposed: `history?: { date, successRatePct, avgDelayMin }[]`, an aggregation over the
append-only `risk_predictions` and `ai_recommendations` logs §1 already keeps.

`history` being **absent** is meaningful and must stay expressible: the UI renders "no history
recorded" rather than an empty chart, and every other figure on the page is explicitly badged
**Demo snapshot**.

**Impact:** an aggregation over existing logs. No new store.

---

## D21 — `DecisionTrace` on detail responses · OPEN · §3, §4 (raised in Phase 3D)

The Master Decision Engine is a documented if/else ladder (project reference §4.3) and its
defensibility is the entire reason it is not a language model. Returning only the resulting
`AIRecommendation` asks the operator to trust an assertion; returning the ladder lets the UI
show the reasoning.

Proposed, on `DeliveryDetailResponse` and `DistrictDetailResponse`:

```ts
DecisionBranch = { id, condition, observed, matched, action }
DecisionTrace  = { branches: DecisionBranch[], outcome: RecommendationType, confidence }
```

Requirements the AI Risk Center is built on:
- branches arrive in **evaluation order**, including the ones that did not match, so the UI can
  show what was tested and what was short-circuited after the first match;
- `observed` carries the actual input values, not a restatement of the condition;
- `confidence` is the confidence of whichever **prediction** drove the matched branch — never a
  separate number invented for the decision itself. This is the runbook's §6 answer, made
  structural.

**Impact:** the engine already evaluates these branches; this returns them.

---

## D22 — `Vehicle.anomaly` · OPEN · §3 (raised in Phase 3D)

Contract 6.12 already defines the GPS-anomaly rule — sustained speed below 40% of expected — and
§1 stores `speedHistory` to evaluate it. The determination is not exposed, so the Live Map would
have to re-derive it client-side and could then disagree with the alert the server raised from
the same rule.

Proposed: optional `anomaly?: { speedRatio, deviationKm?, severity, reason }` on `Vehicle`.

Absent means "behaving normally" — the field is never present with a false flag, so the UI can
never render an anomaly panel for a healthy vehicle.

**Impact:** the rule already runs server-side to raise the alert; this returns its result.

---

## D23 — `getDemoAccounts()` is deliberately NOT an endpoint · **RESOLVED** (frontend-only)

The login page lists the four demo accounts as one-click fills, which is what the runbook asks
for. It previously imported them straight from `data/demo/fixtures`, the one place in the app
that broke the "no fixture imports in pages" rule.

**Decision: it goes through `dataSource.getDemoAccounts()` like everything else, and the HTTP
adapter answers with an empty list.** No endpoint is proposed and none should be built — a real
deployment has no list of shareable credentials. The account panel simply disappears when the
app is pointed at a real backend, with no build flag and no dead code path.

**Impact:** none on the API, by design.

---

## D24 — `District.id` must remain colon-free · **RESOLVED** (frontend-only) · §1 (raised in Phase 3E)

Four features link into Supply Intelligence at a specific district-and-category pair, so the
deep link carries a composite key: `/supply?line=<districtId>:<category>`.

**Reviewed in Phase 3E. The encoding stays, and it is safe for three independent reasons:**

1. Resolution never parses a substring out of the URL. `parseSupplyLineId` splits from the
   **last** colon and validates the suffix against `SupplyCategory`, which is a closed union of
   three colon-free literals. That is correct for any district id, colons included.
2. A value that does not resolve — unknown, truncated, hand-edited, hostile — selects nothing
   and the page falls back to the region's tightest line. There is no lookup to poison.
3. `District.id` is a `uuid` in §1, and a UUID cannot contain a colon. `supplyLink.ts` asserts
   this in development, at the point the link is built, so a Phase 6 backend that switches to
   slugs surfaces the change immediately rather than silently degrading deep links.

**The only requirement this places on the backend: none that §1 does not already impose.** If a
future schema change makes `District.id` free-form text, the development warning fires and the
delimiter should be revisited then — nothing will break in the meantime.

**Impact:** none on the API.

---

## D25 — "now" is a data-layer concern, not a fixture · **RESOLVED** (frontend-only) · (raised in Phase 3E)

Eight product files — including the shell and one design-system primitive — imported `DEMO_NOW`
directly from `data/demo/clock`. Two problems, one of them an integration blocker:

- it broke the standing rule that nothing outside `src/data/` imports `data/demo`;
- pointed at a real backend it would have anchored every relative age, every ETA countdown and
  the header clock to **18 Nov 2024**. Nothing would have thrown; every screen would simply have
  been quietly wrong by two years.

**Resolved frontend-side.** `src/data/clock.ts` exposes `appNow()` / `appNowIso()`, selected by
the same `VITE_DATA_SOURCE` switch as the adapter: `DEMO_NOW` in demo mode, the wall clock in
`http` mode, read per call so a session left open overnight still ages correctly. All twenty
call sites now go through it and `DEMO_NOW` appears nowhere outside `src/data/`.

`formatAge(iso, now)` also lost its `Date.now()` default — omitting the clock is now a compile
error rather than a silent determinism leak.

**Impact:** none on the API. Listed here because it is the seam Phase 6 flips, and because
`Date.now()` now occurs in exactly one place in the entire frontend (`data/clock.ts`, http
branch only).

---

## Phase 4A — deltas settled in the schema

The Prisma schema in `api/prisma/schema.prisma` is PROJECT_CONTRACT.md section 1 plus the
following, each marked `// delta Dnn` at its field. **These are now implemented, not proposed.**

| # | Where | What landed |
|---|---|---|
| D5 | `Delivery.originName`, `.destName` | resolved server-side, nullable |
| D6 | `Vehicle.nearestPlace` | nearest seeded corridor town |
| D8 | `Route.topFactors`, `.explanationText` | per-candidate SHAP, not only the recommendation |
| D11 | new model `VehicleMovement` | the movements log, separate from current vehicle state |
| D12/D13 | `Route.profile`, `.elevationProfile` | nullable JSON; absent is a legal state |
| D15 | `Delivery.cargoUnits`, `.destDistrictId` | `destDistrictId` is what joins deliveries to supply lines |
| D16 | new model `Notification` | one row per dispatch attempt |
| D17 | derived in `services/projections.ts` | baseline / adjusted / drag, no new table |
| D18 | `Incident.segmentId`, `Alert.relatedType`/`relatedId` | already in §1; now exposed |
| D20 | new model `DailyPerformance` | one row per recorded day |

Still **not** implemented, and correctly absent rather than stubbed: **D21** `DecisionTrace`
(needs the decision engine) and **D22** `Vehicle.anomaly` (needs the GPS rule). Both are optional
in the contract and the UI already renders without them.

### New, raised during implementation

**D26 — `User.status`.** Field Operations shows each officer as ACTIVE or OFFLINE and §1's
`User` had nowhere to put it. An officer **is** a user with role `FIELD_OFFICER`; there is no
separate officers table, so `GET /api/field-officers` is a filter rather than a second store that
could disagree. The demo's `field@ner.local` account and its first officer are the same person,
so they are one row — the officer's id wins, because that is the id Field Operations renders.

**D27 — `DemoState`.** A single row saying whether the corridor is showing seeded baseline
conditions or a simulated event. `WeatherSnapshot.isSimulated` says it per segment; the hero band
and status rail need it said once, for the world.

**D28 — `Incident.imageUrl` against a real API · OPEN.** Two seeded incidents carry a field
photograph. In demo mode these are bundled assets; the seed stores `/assets/<file>.jpg`, which
**nothing currently serves**. Phase 4B must either serve those files from the API or accept that
`imageUrl` stays null against a real backend, as contract §6.8 originally specified. Flagged
rather than papered over: the Incident Center renders the field differently when it is absent.

---

## Phase 4B — deltas settled

**D14 — `POST /api/deliveries/:id/reroute` · RESOLVED.** Implemented, transactional, and not
hard-coded to Route B: it accepts any persisted candidate, reassigns the delivery, re-derives
ETA / delay / failure probability from that candidate's own numbers, reprojects the destination's
supply cover, moves the vehicle and its movement record, and re-runs the decision ladder. 409 for
a route that is not a candidate or is already assigned; 404 for an unknown delivery.

**D28 — `Incident.imageUrl` · RESOLVED as null.** Phase 4A flagged that the seed stored
`/assets/<file>.jpg`, which nothing served. Contract §6.8 says the image is not persisted for the
MVP, so `POST /api/incidents` accepts a multipart photograph, holds it in memory, and **discards
it**, writing `imageUrl: null`. No static-asset route was added: serving a file the contract says
is not stored would be inventing a capability, and a URL to a file that does not exist is worse
than an honest null. The Incident Center already renders the absent case ("No photograph was
attached to this report"). When Gemini Vision arrives it writes `cvDetectedClass`, which is a
separate column precisely so the model's claim and the reporter's stay distinguishable.

**D21 — `DecisionTrace` · partially implemented.** The engine now produces the full branch trace
server-side (`services/decision.ts` returns `branches`, `outcome`, `confidence`), but detail
responses do not yet carry it — the frontend renders without it and adding the field is a read-path
change better made alongside Phase 5's model output. The trace exists; it is not yet on the wire.

**D29 — Reset Demo visibility · RESOLVED (frontend, one condition).** Phase 3F gated the control
on `isDemoMode && capabilitiesFor(role).resetDemo`, reasoning that a real deployment has nothing
to reset. Phase 4B made that false: the API implements `POST /api/demo/reset` against the seeded
demonstration database and enforces ADMIN itself. The demo-mode half of the gate hid a control
the server was offering, and no backend mapping can set a client-side boolean — so the condition
became `capabilitiesFor(role).resetDemo` alone. **This is the only frontend change in Phase 4B.**

**D30 — `User.passwordHash` is never on the wire · RESOLVED.** Login and `/auth/me` return
`toUser(...)`, a mapper with no hash field, rather than spreading a Prisma row. The shape makes
the leak impossible rather than relying on remembering to delete a key.

**D31 — `demoGenerated` on Incident / Alert / AIRecommendation / Notification · NEW.** Reset has
to distinguish "restore this value" from "delete this row", and "created recently" is not a safe
proxy. Rows a demonstration creates carry the flag; seeded rows do not. `POST /api/demo/reset`
deletes exactly the flagged rows and leaves operational history alone. A delivery created through
`POST /api/deliveries` deliberately does **not** carry it — a real delivery survives a reset.

---

## Phase 5A — deltas settled

**D32 — `RiskPrediction` carries ML provenance · RESOLVED (additive migration).** The log gains
`entityType` ("SEGMENT" | "ROUTE"), `routeId`, `provenance` ("DETERMINISTIC_DEMO" |
"ML_PREDICTION"), `scenario` ("baseline" | "heavy_rain"), `featureValues` (the twelve inputs) and
`shapBaseValue`; `segmentId` becomes nullable so a row can describe a route. Migration
`phase_5a_ml_predictions` only adds columns with defaults and drops one NOT NULL — every existing
row is correctly labelled `DETERMINISTIC_DEMO`. No second risk table was created.

**D33 — `/api/ml/*` · NEW, backend only.** `GET /api/ml/status`, `POST /api/ml/route-risk/score`
(ADMIN, LOGISTICS_OFFICER) and `GET /api/ml/route-risk/comparison`. The frontend does not call
them; nothing in the UI changed in Phase 5A.

**D34 — ML factors are a superset of `RiskFactor` · NOTE.** A model factor is
`{ factor, feature, value, shapValue, contributionPct, direction }`. `factor` and
`contributionPct` mean exactly what they mean in the frontend's `RiskFactor`, so the existing
factor panels can render a stored ML breakdown unchanged when Phase 5B wires it through.

**D35 — `RouteProfile.trafficLevel` range · DOCUMENTATION FIX NEEDED.** The frontend type
comments it as "0-3, mean across segments"; contract §1 defines `trafficLevel` as 0 / 1 / 2 and
every seeded value is ≤ 1.2. The model and API follow §1 (0–2). The frontend comment is wrong,
not the data.

---

## Phase 5A.1 — deltas settled

**D36 — `SubmitIncidentResponse.segmentMatch` · NEW (additive, optional).**
`{ segmentId, code, name, distanceKm } | null`. Lets the UI say "matched to SEG-010, 0.8 km away"
or, truthfully, that no corridor segment was within 5 km. Optional in the type so an older server
that omits it still satisfies it.

**D37 — Incident location comes from the reporter, never from the UI's selection · FIX.** The
Incident Center intake used to post the coordinates *and segment* of whichever incident was
selected, falling back to a hardcoded point in Bhalukpong (27.0128, 92.6394). Every new report
landed on top of an existing marker. The shared `ReportIncident` flow now posts the point picked
on the map (or typed), and sends no `segmentId` — the server derives it. The demo adapter likewise
rejects a report with no valid location instead of defaulting one.

**D38 — Segment association has a distance limit · FIX.** Nearest-segment matching is now
point-to-line within 5 km (was: nearest midpoint at any distance), and an explicit `segmentId`
must exist. See BACKEND_ARCHITECTURE §8a.

No schema change: `Incident` already had `lat`, `lng`, `segmentId`, `reporterId`, `imageUrl` and
`demoGenerated`. It has no `status` column; none was added, because nothing in this flow needs one.

---

## Phase 5A.2 — deltas settled

**D39 — `RouteCandidate.segmentIds` on the wire · NEW (additive, optional) + tolerance deviation.**
`Route.segmentIds` has been in the schema since 4A (contract §3) but never reached the frontend.
The candidate response now carries it, ordered as the route reaches the segments (§6.7), and Route
Intelligence shows which corridor segments each route travels and which it bypasses. Optional in
the type so an older server that omits it still satisfies it.

The rule deviates from §6.7 in one number: a segment belongs to a route when its midpoint is
within **3 km** of the route's line, not 5 km. §6.7 was written for OpenRouteService geometry. The
MVP alternates run close beside the corridor before they leave it, and at 5 km they claim stretches
they do not drive: SEG-003 for Route B (3.3 km off its line), SEG-005 and SEG-012 for Route C (3.2 and
4.4 km). At 3 km: A travels all 15, B travels 001–002 and 011–015 (bypassing SEG-003…SEG-010, including
the storm segment SEG-010), C travels 001–003, 006–008 and 013–015. Revisit when ORS geometry lands.
One implementation (`routeSegmentIds`, `web/src/domain/geo.ts`) serves both the demo adapter and
the world exporter, so both data sources store the same association.

**D40 — Alternate candidates have their own geometry · FIX (no contract change).** Routes B and C
were drawn as Route A's polyline shifted sideways (`offsetPath`, −13 km / +17 km). They now follow
their own waypoints through real towns (B: Mangaldoi → Udalguri → Kalaktang → Bomdila → Sela Tunnel;
C: Tezpur → Balipara → Seijosa → Seppa → Dirang → Jang), deterministic and smoothed the same way as
A. Their terrain profiles are measured along their own lines and labelled with their own towns. The
stated road distances (448.6 / 471.2 / 512.4 km), ETAs and risk scores are unchanged; the drawn lines
are schematic and shorter than the stated road distance until ORS supplies road geometry.

**D41 — Delivery risk is a model, and `RiskPrediction` carries it (Phase 6B).** `Delivery.failureProbability`
and `expectedDelayMinutes` were seeded constants replayed by the cascade. They are now also
predictable by `delivery-risk-xgb-v1` — an XGBClassifier for the probability and an XGBRegressor
for the minutes, on one seven-feature contract (`distanceRemainingKm`, `currentSpeedKmh`,
`routeRiskScore`, `weatherSeverity`, `cargoPriority`, `hourOfDay`, `dayOfWeek`).

Two additive nullable columns on `RiskPrediction` (migration
`20260917142219_phase_6b_delivery_risk_predictions`):

  deliveryId             set when entityType = "DELIVERY", application-managed like routeId
  predictedDelayMinutes  the delay head's output; null on SEGMENT and ROUTE rows

A delivery row stores the failure probability in `riskScore` as an integer percentage, so every
row on the table stays comparable on one 0-100 scale, with the minutes in their own column.
`topFactors` holds the failure head's SHAP factors; each factor now carries `shapUnit`
(`log_odds` for failure, `log1p_minutes` for delay, absent for route risk, which explains in
points) so a contribution can never be read as a percentage of the prediction.

**D42 — Scoring a delivery does not move the world unless asked (Phase 6B).**
`POST /api/ml/delivery-risk/score` (ADMIN, LOGISTICS_OFFICER) predicts for every live delivery and
persists the predictions. With `{"apply": true}` it also writes the predicted delay into
`Delivery.expectedDelayMinutes` and `currentEta` (adjusted ETA = current ETA + predicted delay),
the probability into `failureProbability`, reprojects the destination's medicine cover through the
existing projection, and re-runs the unchanged Decision Engine over the result.

Read-only by default, because the demonstration is a deterministic replay and the runbook's
numbers depend on it: the model may disagree with the frozen story, and both are then visible —
the replayed values in the product, the model's in the prediction log — rather than one silently
overwriting the other. `POST /api/demo/reset` restores the baseline after an applied run.

**D43 — Route comparison is an endpoint, not a derivation in three places (Phase 6C).**
`GET /api/routes/comparison?deliveryId=&preferMl=` returns every candidate with its own risk,
level, ETA, distance, segments and SHAP factors, plus `riskDelta` against the route the delivery
is on, `clearsSaferMargin`, `saferCandidateId` and `rerouteAdvised`. The margin and threshold are
imported from `decision.ts` (15 points, 70) rather than repeated, so the comparison and the engine
cannot disagree. `preferMl=true` swaps in the latest stored ML score per route; the default is
what the product displays. Each candidate carries `source`, because the two can differ.

**D44 — Delivery risk can be previewed on another route, and a reroute can re-score (Phase 6C).**
`POST /api/ml/delivery-risk/preview { deliveryId, routeId }` scores a delivery as if it were on a
candidate route. Nothing is persisted: a question is not an observation, and a prediction log full
of hypotheticals stops being a record of what the system believed.
`POST /api/deliveries/:id/reroute` accepts `{ rescore: true }`, which re-runs the delivery model
on the new road and lets the result flow through ETA, the destination's cover and the Decision
Engine. Default is off, so the demonstration keeps its deterministic reroute.

**D45 — Supply projection is explained, not just stated (Phase 6C).** Each entry of the district
detail's `projections` gains a `projection` object: hourly consumption, `coverHours`, `stockoutAt`,
`safetyThresholdHours` (the engine's 48), `crossesThresholdAt`, the inbound `resupply` with the
hours it adds, `coverWithResupplyHours`, and a plain-English `explanation` built from those
numbers. The headline `predictedStockoutHours` is unchanged, and `coverHours` reproduces it
exactly (stock ÷ consumption), so nothing on screen moves. A resupply arriving after the shelf
empties adds nothing — the gap is reported rather than averaged away.

**D46 — Gemini explains; it never computes (Phase 6C).** `POST /api/ai/explain { kind, targetId }`
builds the figures server-side from what the product displays, sends them to Gemini for prose, and
returns the sentence with the figures beside it. Three guarantees:

  * the model receives numbers and returns words. It is never asked for a score, a probability, a
    delay, a stockout or a decision;
  * every reply passes `containsOnlyKnownNumbers()`. A number that was not in the data — with
    hours-from-minutes and days-from-hours conversions allowed — discards the reply;
  * every failure (no key, timeout, HTTP error, invented number) falls back to a deterministic
    template built from the same figures. The explanation is never lost, and never unlabelled:
    `provenance.explanation` is `LLM_EXPLANATION` or `DETERMINISTIC_TEMPLATE`.

Only successful replies are cached, keyed on the figures. Caching a failure would turn one busy
minute at the provider into a permanent outage.

**D47 — Incident photographs are classified as evidence (Phase 6C, supersedes part of D28).** When
a photograph is uploaded and a key is configured, Gemini Vision fills `cvDetectedClass`,
`cvConfidence` and `cvEstimatedBlockage`, and the response carries `visionEvidence` including
`agreesWithReporter`. The reporter's `type`, `severity` and coordinates are untouched — the image
is a second opinion recorded beside the report, never over it. The file is still not persisted
(D28 stands): it is classified in memory and discarded. Any failure returns null and the incident
is filed exactly as reported.

**D48 — Reset drops predictions of the world it undid (Phase 6C).** `POST /api/demo/reset` now also
deletes `RiskPrediction` rows with `provenance=ML_PREDICTION` and `scenario=heavy_rain`. They
describe a storm that no longer happened. Baseline ML rows survive, because they describe the
world being restored.

**D49 — An incident belongs to a corridor even when it matches no segment.** The 15 `RouteSegment`
rows describe ONE road: Route A, Guwahati -> Tawang via NH-15/NH-13. Routes B and C have their own
geometry and borrow A's segments where they overlap, so a report on the stretch only Route B
travels — Udalguri to Bhairabkunda — is genuinely 24.9 km from every stored segment and correctly
matches none. The interface then had nothing to say about it.

`Incident` gains `routeImpact?: { routeId, name, distanceKm, riskScore, riskLevel }`: the nearest
candidate route whose polyline passes within `MAX_ROUTE_DISTANCE_KM` (5 km), or absent. Computed
on read from `Route.geometry` rather than stored, because route geometry changes (ORS will change
all three) and a column written once would describe a road that no longer runs there.
`POST /api/incidents` returns the same thing as `routeMatch` alongside `segmentMatch`.

Segment matching is unchanged — same 5 km, same method, no widening — because it was never wrong.
The two answers are different questions: which scored segment does this sit on, and which corridor
does it sit on.

---

## Deferred to Phase 4 review

- ~~Whether the ML service returns SHAP for every candidate~~ — resolved as D8 above.
- Whether `RouteCandidate.geometry` stays `[lat, lng]` app-internal order across the wire
  (contract 6.2 says yes; confirm ORS conversion happens server-side only).
- Socket.IO event names and payloads — `vehicle:update`, `alert:new`, `cascade:complete` are
  assumed by the frontend but not specified anywhere in the contract.
- The GPS-anomaly cooldown contradiction between §6.12 and §1's alert dedup, carried over from
  the previous build's Session H and still unresolved.
