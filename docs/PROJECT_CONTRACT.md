# NER-SupplyAI — Project Contract (Source of Truth) — v2

**Rule for both tools: nothing gets built that deviates from this document. If a shape needs to change mid-build, this file gets edited first, then both sides adjust.**

**What Claude Code may and may not do without updating this file first (see review point #81):**
- MAY freely change: internal implementation, file structure, library choices, code style.
- MAY NOT, without editing this contract first: change the database schema, change any API request/response shape, rename or add enum values, add a new external service/API, or change any type in section 3. If something is missing, flag it here first.

---

## 0. System architecture — who talks to whom

```
Frontend (Cursor)
   ↓ (public API, JWT auth)
Node / Express  ← the ONLY public backend. Frontend never calls FastAPI or Gemini/ORS/Twilio directly.
   ↓ (internal, no auth needed — same private network/localhost)
FastAPI (ML service)  — exposes /internal/* routes only
   ↓
XGBoost models, SHAP, and it also proxies to Gemini vision when needed
```

Node also calls OpenRouteService and Twilio directly (not through FastAPI) — those aren't ML, no reason to route them through Python. **Twilio (both SMS and Voice Call) is handled entirely server-side by Node/Express — the frontend never holds Twilio credentials or calls Twilio in any form; it only ever reads back `Alert.notifiedViaTwilio` via `GET /api/alerts`.**

**LLM provider for this MVP: Gemini, and only Gemini (review #7).** Every place this document
previously said "Gemini/Claude" or "(or Claude)" meant Gemini specifically — the app has a live
Gemini API key and no reason to integrate a second provider. Gemini is used for exactly two
things: (1) turning SHAP topFactors into `explanationText`, and (2) incident image classification
at `/internal/vision/classify`. Claude (via Claude Code) is the coding agent building this
project, not a runtime dependency of the application — do not add an Anthropic API call anywhere
in the app itself.

**Health checks (review #51, #52):**
```
GET /health          (Node)   → { status: "ok", db: "ok" | "error" }
GET /internal/health  (FastAPI) → { status: "ok", modelsLoaded: boolean }
```

---

## 1. Database Schema (Prisma-style, PostgreSQL)

```prisma
enum Role {
  ADMIN
  LOGISTICS_OFFICER
  FIELD_OFFICER
  DISTRICT_OFFICER
}

enum CargoPriority {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum DeliveryStatus {
  PENDING
  IN_TRANSIT
  AT_RISK
  DELIVERED
  FAILED
}

enum RoadCondition {
  GOOD
  FAIR
  POOR
}

enum SegmentStatus {
  OPEN
  PARTIAL
  BLOCKED
}

enum IncidentType {
  LANDSLIDE
  FLOOD
  DEBRIS
  DAMAGED_ROAD
  BLOCKED_ROAD
  NORMAL
}

enum Severity {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum RiskLevel {
  LOW
  MEDIUM
  HIGH
  CRITICAL
}

enum RecommendationType {
  REROUTE
  PRE_POSITION
  ALERT
  NONE
}

enum BlockageLevel {
  NONE
  PARTIAL
  SEVERE
}

model User {
  id           String   @id @default(uuid())
  name         String
  email        String   @unique
  passwordHash String
  role         Role
  phone        String?  // required for Twilio alerts on FIELD_OFFICER/DISTRICT_OFFICER accounts
  districtId   String?
  createdAt    DateTime @default(now())
}

model District {
  id        String   @id @default(uuid())
  name      String
  state     String
  lat       Float
  lng       Float
  createdAt DateTime @default(now())
}

model Warehouse {
  id         String   @id @default(uuid())
  name       String
  districtId String
  lat        Float
  lng        Float
}

model InventoryItem {
  id                     String    @id @default(uuid())
  ownerType              String    // "DISTRICT" | "WAREHOUSE" — application-managed polymorphic ref, no Prisma relation
  ownerId                String
  itemType               String    // "medicine" | "food" | "fuel"
  currentStock           Int
  dailyConsumption       Float
  predictedStockoutHours Float?    // null when dailyConsumption <= 0 (see section 6.4)
  lastRestockedAt        DateTime?
  updatedAt              DateTime  @updatedAt
}

// NEW (review #8): historical record of stockout crossings, since InventoryItem only holds current state.
// Written whenever predictedStockoutHours crosses below the CRITICAL threshold (see 6.4) for a given item.
model StockoutEvent {
  id            String   @id @default(uuid())
  districtId    String
  itemType      String
  hoursAtEvent  Float
  triggeredBy   String   // "SIMULATE_RAIN" | "INCIDENT" | "SCHEDULED_CHECK"
  createdAt     DateTime @default(now())
}

model Vehicle {
  id                String   @id @default(uuid())
  code              String   @unique
  driverName        String
  driverPhone       String?
  currentLat        Float
  currentLng        Float
  speedKmh          Float
  expectedSpeedKmh  Float
  status            String   // "IDLE" | "IN_TRANSIT" | "STOPPED"
  currentDeliveryId String?
  currentRouteId    String?  // application-managed reference to Route.id (NOT a Prisma @relation,
                             // same pattern as InventoryItem's ownerId — see review #10) — and
                             // NOT a RouteSegment id
  // Rolling speed window for GPS anomaly detection (review #34) — not persisted per-reading;
  // keep the last 6 readings in an in-memory map keyed by vehicle id. See section 6.11.
  updatedAt         DateTime @updatedAt
}

model RouteSegment {
  id                          String        @id @default(uuid())
  code                        String        @unique
  name                        String
  startLat                    Float
  startLng                    Float
  endLat                      Float
  endLng                      Float
  terrainSlopeDeg             Float
  elevationM                  Float
  roadCondition               RoadCondition
  roadType                    String        // "highway" | "state_road" | "rural"
  distanceToRiverKm           Float
  historicalLandslides        Int
  historicalFloods            Int
  previousClosureFrequencyPct Float
  trafficLevel                Int           // NEW (review #2) — 0=low, 1=medium, 2=high. Was referenced by the ML plan but missing from schema.
  currentStatus               SegmentStatus @default(OPEN)
  lastRiskScore                Int?
  lastRiskFactors              Json?        // RiskFactor[] — see section 6.6 for what this array means
  updatedAt                    DateTime     @updatedAt
}

// NEW (review #68-71): a persisted candidate route, not an ephemeral API-only object.
// Every candidate returned by POST /api/routes/candidates is written here immediately,
// which is what lets Delivery.assignedRouteId and Vehicle.currentRouteId point to something
// real, and lets the cascade answer "which routes pass through this segment?"
model Route {
  id            String    @id @default(uuid())
  name          String    // e.g. "Route A — NH-13" — generated at creation time (letter by rank + dominant roadType among its segments), see section 6.7
  originLat     Float
  originLng     Float
  destLat       Float
  destLng       Float
  distanceKm    Float
  etaMinutes    Int
  geometry      Json      // [[lat, lng], ...] — app-internal order, see section 6.2
  segmentIds    String[]  // ordered RouteSegment ids this candidate passes within tolerance (section 6.7)
  riskScore     Int
  riskLevel     RiskLevel
  isRecommended Boolean   @default(false)
  createdAt     DateTime  @default(now())
}

model Delivery {
  id                    String        @id @default(uuid())
  code                  String        @unique
  cargoType             String
  priority              CargoPriority
  originLat             Float
  originLng             Float
  destLat               Float
  destLng               Float
  assignedVehicleId     String?
  assignedRouteId       String?       // application-managed reference to Route.id (NOT a Prisma
                                       // @relation — same app-managed pattern as InventoryItem's
                                       // ownerId, review #10). Set by POST /api/routes/candidates
                                       // when deliveryId is supplied — see section 4.
  requiredEta           DateTime
  currentEta            DateTime
  failureProbability    Float?
  expectedDelayMinutes  Int?
  status                DeliveryStatus @default(PENDING)
  createdAt             DateTime @default(now())
}

model Incident {
  id                  String        @id @default(uuid())
  reporterId          String
  segmentId           String?       // resolved by nearest-segment lookup if not supplied — see section 6.7
  type                IncidentType  // reporter-selected, NEVER overwritten by AI (review #43)
  severity            Severity
  description         String?
  imageUrl             String?      // NOT persisted for MVP — see section 6.8. Stays null.
  cvDetectedClass      String?      // AI-detected, kept separate from `type`
  cvConfidence         Float?
  cvEstimatedBlockage  BlockageLevel?
  lat                  Float
  lng                  Float
  createdAt            DateTime @default(now())
}

model RiskPrediction {
  id                  String    @id @default(uuid())
  segmentId           String
  riskScore           Int
  riskProbability     Float
  riskLevel           RiskLevel
  predictedDisruption Boolean
  topFactors          Json      // RiskFactor[] — { factor: string, contributionPct: number }[], see 6.6
  explanationText     String
  modelVersion        String    // e.g. "route-risk-xgb-v1", never a bare "1.0" (review #77)
  createdAt           DateTime  @default(now())
}
// NOTE: this table is an append-only historical log, not current state (review #38).
// Every simulate-rain run and every incident-triggered recalculation adds a new row.
// lastRiskScore/lastRiskFactors on RouteSegment hold current state; this table is history for Analytics.

model AIRecommendation {
  id                 String   @id @default(uuid())
  type               RecommendationType
  targetType         String   // "DELIVERY" | "DISTRICT" | "ROUTE"
  targetId           String
  recommendationText String
  confidence         Float    // 0-1 always — frontend multiplies by 100 for display, never sent pre-formatted
  status             String   @default("PENDING") // "PENDING" | "ACTED" | "DISMISSED"
  createdAt          DateTime @default(now())
}

model Alert {
  id                String   @id @default(uuid())
  severity          Severity
  title             String
  message           String
  relatedType       String?  // "DELIVERY" | "ROUTE" | "DISTRICT" | "INCIDENT"
  relatedId         String?
  notifiedViaTwilio Boolean  @default(false)  // true if AT LEAST ONE Twilio channel (SMS or Voice) succeeded
  twilioSid         String?                   // SID of the SMS message, if sent
  smsStatus         String   @default("NOT_ATTEMPTED") // "SENT" | "FAILED" | "NOT_ATTEMPTED" (review: voice call addition)
  callStatus        String   @default("NOT_ATTEMPTED") // "SENT" | "FAILED" | "NOT_ATTEMPTED" — only ever attempted for CRITICAL severity
  twilioCallSid     String?                   // SID of the voice call, if placed
  createdAt         DateTime @default(now())
}
// Dedup rule (review #36): before creating an alert, check for an existing alert with the
// same relatedType + relatedId + severity created in the last 10 minutes. If found, skip
// creating a new one rather than spamming duplicates from repeated cascade runs. This dedup
// gates the entire notification action for that alert — since no new Alert row means no new
// notification attempt, it prevents duplicate SMS AND duplicate voice calls alike, not just SMS
// (voice call addition — see 6.10).

model WeatherSnapshot {
  id           String   @id @default(uuid())
  segmentId    String
  rainfall1h   Float
  rainfall3h   Float
  rainfall6h   Float
  rainfall24h  Float
  windSpeedKmh Float
  visibility   String   // "good" | "moderate" | "low"
  isSimulated  Boolean  @default(false)
  createdAt    DateTime @default(now())
}
// No external weather API for MVP (review #32). Rows are seeded, and mutated only by
// POST /api/demo/simulate-rain. Do not add a real weather API integration.
```

---

## 2. Global thresholds — used identically everywhere, frontend and backend (review #4, #57, #61, #62)

**Risk level (`riskScore`, integer 0-100 — applies to route segments, route candidates, and anywhere else a riskScore appears):**
```
0-39    LOW      → moss
40-69   MEDIUM   → signal-amber
70-84   HIGH     → signal-amber
85-100  CRITICAL → rust
```
UI note: HIGH and MEDIUM both render `signal-amber` (the palette only has 3 accent colors for 4 risk levels) — rust is reserved for CRITICAL only, moss for LOW only.

**Delivery failure risk (`failureProbability`, float 0-1):**
```
0.00-0.39   LOW
0.40-0.69   MEDIUM
0.70-0.84   HIGH
0.85-1.00   CRITICAL
```
Same bucket boundaries as riskScore, just on a 0-1 scale instead of 0-100.

**Stockout urgency (`predictedStockoutHours`):**
```
< 48h        CRITICAL → rust
48h - 96h    WARNING  → signal-amber
>= 96h       NORMAL   → moss
```

These three threshold tables are the *only* place bucket boundaries are defined. Nothing in Cursor's prompt or Claude Code's implementation should invent its own thresholds.

---

## 3. Shared TypeScript Types (frontend uses these exactly)

```typescript
type Role = "ADMIN" | "LOGISTICS_OFFICER" | "FIELD_OFFICER" | "DISTRICT_OFFICER";
type CargoPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type DeliveryStatus = "PENDING" | "IN_TRANSIT" | "AT_RISK" | "DELIVERED" | "FAILED";
type SegmentStatus = "OPEN" | "PARTIAL" | "BLOCKED";
type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"; // used everywhere a risk/failure level is returned — never a bare `string`

interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  districtId?: string;
}

interface Vehicle {
  id: string;
  code: string;
  driverName: string;
  currentLat: number;
  currentLng: number;
  speedKmh: number;
  expectedSpeedKmh: number;
  status: "IDLE" | "IN_TRANSIT" | "STOPPED";
  currentDeliveryId?: string;
}

interface RiskFactor {
  factor: string;
  contributionPct: number; // normalized ABSOLUTE contribution for display only — top factors do not need to sum to 100 (review #39)
}

interface RouteCandidate {
  id: string;             // real Route.id, persisted — not a request-scoped string
  name: string;            // e.g. "Route A — NH-13" (review #12)
  distanceKm: number;
  etaMinutes: number;
  geometry: [number, number][]; // [lat, lng] pairs, app-internal order (review #3, #13)
  riskScore: number;      // 0-100
  riskLevel: RiskLevel;
  isRecommended: boolean;
  topFactors: RiskFactor[];
  explanationText: string;
}

interface Delivery {
  id: string;
  code: string;
  cargoType: string;
  priority: CargoPriority;
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  assignedVehicleId?: string;
  assignedRouteId?: string;
  requiredEta: string;   // ISO date string
  currentEta: string;
  failureProbability?: number;  // 0-1
  expectedDelayMinutes?: number;
  status: DeliveryStatus;
}

interface RouteSegment {
  id: string;
  code: string;
  name: string;
  startLat: number;      // NEW — exposes DB field already in the Prisma model, section 1
  startLng: number;      // NEW
  endLat: number;        // NEW
  endLng: number;        // NEW
  currentStatus: SegmentStatus;
  lastRiskScore: number;
  lastRiskFactors?: RiskFactor[];
}
// The four coordinate fields were added after Frontend Session A. They expose columns that
// already exist on the Prisma model in section 1 — this is NOT a schema change, only a wider
// public projection. GET /api/risk/segments must now return them. Without coordinates there is
// no way to draw a segment-anchored risk zone on the Live Logistics Map, which the frontend
// spec requires; the Session A build had to approximate zones from Incident lat/lng instead.

interface District {
  id: string;
  name: string;
  lat: number;
  lng: number;
  stock: {
    medicine: { currentStock: number; dailyConsumption: number; predictedStockoutHours: number | null };
    food: { currentStock: number; dailyConsumption: number; predictedStockoutHours: number | null };
    fuel: { currentStock: number; dailyConsumption: number; predictedStockoutHours: number | null };
  };
}

interface Incident {
  id: string;
  type: "LANDSLIDE" | "FLOOD" | "DEBRIS" | "DAMAGED_ROAD" | "BLOCKED_ROAD" | "NORMAL"; // reporter-selected
  severity: Severity;
  description?: string;
  imageUrl?: string;             // always null for MVP — image is not persisted (section 6.8)
  cvDetectedClass?: string;      // AI-detected — may differ from `type`, never overwrites it
  cvConfidence?: number;
  cvEstimatedBlockage?: "NONE" | "PARTIAL" | "SEVERE";
  lat: number;
  lng: number;
  createdAt: string;
}

interface AIRecommendation {
  id: string;
  type: "REROUTE" | "PRE_POSITION" | "ALERT" | "NONE";
  targetType: "DELIVERY" | "DISTRICT" | "ROUTE";
  targetId: string;
  recommendationText: string;
  confidence: number; // 0-1 — frontend formats as a percentage, backend never pre-formats
}

interface Alert {
  id: string;
  severity: Severity;
  title: string;
  message: string;
  notifiedViaTwilio: boolean; // UI copy stays "Notified via Twilio". The backend now tracks SMS
                               // and Voice Call separately (Alert.smsStatus/callStatus, voice
                               // call addition — contract 6.10), but this public field stays a
                               // single boolean by design (review #22, #58) — don't expose
                               // per-channel detail to the frontend or change this API shape.
  createdAt: string;
}

interface FieldOfficer {
  id: string;
  name: string;
  phone?: string;
  districtId?: string;
  status: "ACTIVE" | "OFFLINE"; // derived server-side, not stored — see section 4
}
```

---

## 4. Public API Endpoints (Node/Express — exact request/response shapes)

### Auth
```
POST /api/auth/login
  body: { email: string, password: string }
  200: { token: string, user: User }
  401: { error: string }
  // JWT expires in 24h (review #54)

GET /api/auth/me
  headers: { Authorization: "Bearer <token>" }
  200: { user: User }
  // Note: since the frontend keeps the token in memory only (no localStorage, section on Auth
  // handling in CURSOR_PROMPT.md) and does not persist sessions across a page refresh, this
  // endpoint is not called anywhere in the current 10-page spec. It exists for API completeness
  // / future session-persistence work — do not build a client.ts function or UI for it in MVP.
```

**Demo credentials (review #27) — seed script must create exactly these four accounts:**
```
admin@ner.local       / demo123   (ADMIN)
logistics@ner.local   / demo123   (LOGISTICS_OFFICER)
field@ner.local       / demo123   (FIELD_OFFICER)
district@ner.local    / demo123   (DISTRICT_OFFICER)
```

**Role permission matrix (review #28):**
```
                    view all pages          create delivery   create incident   simulate rain   trigger reset
ADMIN                    yes                     yes                yes             yes             yes
LOGISTICS_OFFICER   yes, except FieldOps         yes                yes             yes             no
FIELD_OFFICER        FieldOps+Incidents only     no                 yes             no              no
DISTRICT_OFFICER     Supply+Analytics only       no                 no              no              no
```

### Vehicles
```
GET /api/vehicles
  200: { vehicles: Vehicle[] }

GET /api/vehicles/:id
  200: { vehicle: Vehicle }
```
Live updates via Socket.IO event `vehicle:update` → payload: `Vehicle`

### Field Officers (NEW — review #6)
```
GET /api/field-officers
  200: { officers: FieldOfficer[] }
  // No real field-officer devices or heartbeat mechanism exist in this MVP — hardcode every
  // seeded field officer's status to "ACTIVE". The field exists in the type for a future real
  // presence check; don't build tracking infrastructure to populate it now.
```

### Deliveries
```
GET /api/deliveries
  200: { deliveries: Delivery[] }

GET /api/deliveries/:id
  200: { delivery: Delivery, recommendation?: AIRecommendation }
  // recommendation is the latest AIRecommendation row where targetType="DELIVERY" and
  // targetId=this delivery's id — read from what the cascade/Decision Engine already wrote,
  // never computed fresh on this GET. Omit the field if none exists yet.

POST /api/deliveries
  body: { cargoType, priority, originLat, originLng, destLat, destLng, requiredEta }
  201: { delivery: Delivery }
```

### Routes
```
POST /api/routes/candidates
  body: { originLat: number, originLng: number, destLat: number, destLng: number, cargoPriority: CargoPriority, deliveryId?: string }
  200: { candidates: RouteCandidate[] }
  // topFactors/explanationText per candidate are derived from the candidate's dominant segment,
  // NOT a fresh SHAP/Gemini call — see section 6.13.
  // Persists each candidate as a Route row immediately (see schema). The Route Intelligence
  // page reaches this by first selecting a Delivery, which prefills origin/destination from it
  // (review #11) — don't build a free-standing coordinate entry form as the primary path.
  // If ORS is unavailable, return 503 { error: "Routing service unavailable" } rather than
  // fabricating geometry (review #26) — do not silently invent fake routes.
  //
  // Delivery/Vehicle assignment (review #3): if deliveryId is supplied in the request body,
  // after generating and persisting all candidates:
  //   1. mark the lowest-riskScore candidate isRecommended = true (this is "Route A")
  //   2. set Delivery.assignedRouteId = that recommended Route's id
  //   3. if the delivery has an assignedVehicleId, also set that Vehicle.currentRouteId to
  //      the same Route id
  // This is what lets the cascade (recalculateFromSegmentChange) look up "which route is this
  // delivery currently on" without re-running route generation. If deliveryId is omitted
  // (e.g. an exploratory call), skip steps 2-3 — candidates are still persisted, just not
  // attached to a delivery.
```

### Risk
```
GET /api/risk/segments
  200: { segments: RouteSegment[] }   // sorted by lastRiskScore desc

POST /api/ai/risk
  body: { segmentId: string }
  200: { riskScore: number, riskLevel: RiskLevel, topFactors: RiskFactor[], explanationText: string }
  // Proxies to FastAPI /internal/predict-risk. If the Gemini explanation call fails, fall back
  // to a deterministic templated sentence built from topFactors (review #25) rather than failing
  // the whole request.
```

### Delivery Risk (NEW — review #1, was entirely missing)
```
POST /api/ai/delivery-risk
  body: { deliveryId: string }
  200: { failureProbability: number, expectedDelayMinutes: number }
  // This endpoint is called by the cascade function (internally by Node), not by the frontend —
  // it's what populates Delivery.failureProbability/expectedDelayMinutes, which the frontend
  // reads back via GET /api/deliveries/:id. Node resolves the feature vector itself before
  // calling FastAPI: look up the delivery's assigned Route (for routeRiskScore), its assigned
  // Vehicle (for currentSpeedKmh, distanceRemainingKm from current position to destination),
  // and weatherSeverity computed per section 6.3 from the WeatherSnapshot of the route's
  // riskiest segment. Only THEN does Node call FastAPI's /internal/predict-delivery-risk with
  // the fully-resolved feature vector below — the caller of this public endpoint never supplies
  // raw ML features, only a deliveryId.
```

### Incidents
```
POST /api/incidents   (multipart/form-data)
  body: { type, severity, description, lat, lng, segmentId?, image: File }
  201: { incident: Incident, cascadeTriggered: boolean }
  // If segmentId is omitted, resolve to the nearest RouteSegment within 5km of (lat, lng)
  // using straight-line distance to segment midpoint (review #7, #45). If none within 5km,
  // segmentId stays null and no cascade runs.
  // Server sends the image to FastAPI's vision endpoint (never persists it — section 6.8).
  // `type` is always the reporter's selection and is never overwritten by the AI result
  // (review #43). If cvDetectedClass is LANDSLIDE/FLOOD/DEBRIS/DAMAGED_ROAD/BLOCKED_ROAD
  // (review #6 — DAMAGED_ROAD was previously missing from this list despite being a full
  // enum value; all five non-NORMAL classes trigger the cascade identically) with
  // cvConfidence >= 0.7 AND a segmentId was resolved, update that RouteSegment.currentStatus
  // and run the same cascade function used by /api/demo/simulate-rain. cascadeTriggered
  // reflects whether this ran.

GET /api/incidents
  200: { incidents: Incident[] }
```

### Supply
```
GET /api/districts
  200: { districts: District[] }

GET /api/districts/:id
  200: { district: District, recommendation?: AIRecommendation }
  // Same rule as the delivery endpoint above: latest AIRecommendation with targetType="DISTRICT"
  // and targetId=this district's id, written by the cascade when a stockout crosses the CRITICAL
  // threshold (section 2) — not computed fresh on this GET. Omit if none exists yet.
```

### Decision Engine / Alerts
```
POST /api/ai/decision
  body: { deliveryId: string }
  200: { action: "REROUTE" | "PRE_POSITION" | "ALERT" | "NONE", confidence: number, reason: string }
  // Decision logic — evaluated in this exact priority order (review #1), first match wins:
  //   IF routeRisk >= 70 AND saferRouteExists         → REROUTE
  //   ELSE IF adjustedStockoutHours < 48               → PRE_POSITION
  //   ELSE IF failureProbability >= 0.85               → ALERT
  //   ELSE                                              → NONE
  // routeRisk = riskScore of the delivery's assignedRoute. saferRouteExists = true if a
  // candidate from the delivery's last /api/routes/candidates call has riskScore at least
  // 15 points lower than the current assignedRoute (re-run candidates if none cached).
  // adjustedStockoutHours = the destination district's item-level value per section 6.5.
  // failureProbability comes from the delivery's stored value (section on /api/ai/delivery-risk).
  // confidence = the confidence of whichever underlying prediction drove the branch taken
  // (route riskProbability for REROUTE, the delivery's failureProbability for PRE_POSITION,
  // failureProbability for ALERT, 1.0 for NONE). PRE_POSITION previously specified
  // 1 - normalizedStockoutHours/48; that expression measured the crossing MARGIN, not the
  // confidence of a prediction, and was structurally incapable of exceeding ~8% because a
  // crossing requires a base >= 48h while the delay model produces only a few hours. Since
  // PRE_POSITION fires because a predicted delay pushed adjustedStockoutHours below 48, the
  // prediction that drove the branch is the delivery-risk model, and its failureProbability
  // is this branch's confidence — consistent with the rule this same sentence already applies
  // to the other three branches.
  // reason is a 1-sentence templated string,
  // e.g. "Route risk 87 with a safer alternative available." — no LLM call needed here,
  // this is deterministic branching, not a generation task.
  // When action != NONE, the cascade creates an Alert whose severity is derived from this
  // action per section 6.14 (reuses section 2's threshold tables, no new ones invented) —
  // that Alert.severity is what section 6.10 keys the SMS/Voice Call decision off of.

GET /api/alerts
  200: { alerts: Alert[] }   // sorted by severity, then recency

POST /api/demo/simulate-rain
  body: { segmentId: string }
  200: { updated: true, affectedSegmentIds: string[] }
  // For the live demo, the UI should default this to a predetermined DEMO_SEGMENT_ID
  // rather than requiring the presenter to pick one under pressure (review #63).
  //
  // After re-scoring, if the segment's new riskScore lands in the CRITICAL bucket (>= 85,
  // section 2), set RouteSegment.currentStatus = PARTIAL. Below 85, leave currentStatus
  // unchanged. POST /api/demo/reset restores it to its seeded value (OPEN).
  // The incident path (POST /api/incidents) remains the only writer of BLOCKED and continues
  // to derive status from cvEstimatedBlockage — this rule does not change that path.

POST /api/demo/reset   (NEW — review #64)
  200: { reset: true }
  // Restores seeded demo state: re-runs the seed script's data (or restores a pre-saved
  // snapshot) so WeatherSnapshot, RiskPrediction, Alert, StockoutEvent, and Route rows
  // created during rehearsal don't carry into the actual judging run.
```

### Analytics
```
GET /api/analytics/summary
  200: {
    deliverySuccessRatePct: number,
    avgDelayMinutes: number,
    topRiskySegments: { segmentId: string, name: string, avgRisk: number }[],
    districtShortageEvents: { districtId: string, name: string, count: number }[]
  }
  // Renamed from topRiskyRoutes (review #9) — the shape holds RouteSegment data
  // (segmentId, not a Route id), so the name must say segments, not routes, to avoid
  // conflating Route and RouteSegment throughout the app.
  //
  // deliverySuccessRatePct = (count of Delivery where status="DELIVERED") /
  //   (count of Delivery where status IN ("DELIVERED","FAILED")) * 100, over all
  //   seeded/generated deliveries. Deliveries still PENDING/IN_TRANSIT/AT_RISK are excluded
  //   from the denominator (review #2).
  //
  // avgDelayMinutes = average(Delivery.expectedDelayMinutes) across all deliveries where
  //   expectedDelayMinutes is not null (review #2) — there is no separate delivery-history
  //   table for MVP; this reads directly off the Delivery table's current state.
  //
  // topRiskySegments = top 5 RouteSegment rows by lastRiskScore desc, mapped to
  //   { segmentId: id, name, avgRisk: lastRiskScore }. "avg" is a display label only —
  //   it's the segment's current score, not an average over time (no history needed here,
  //   RiskPrediction remains the append-only log for anything that does need history).
  //
  // districtShortageEvents counts rows in StockoutEvent grouped by district (review #8),
  // not derived from InventoryItem's current-state-only fields.
  //
  // NOTE (review #8): this endpoint returns single current aggregates, not time series.
  // "avg delay over time" / "success rate trend" are NOT supported — see CURSOR_PROMPT.md's
  // Analytics page, which has been corrected to match (no line-chart-over-time widgets).
```

---

## 5. Internal API Endpoints (FastAPI — never called by the frontend directly)

```
GET /internal/health
  200: { status: "ok", modelsLoaded: boolean }

POST /internal/predict-risk
  body: { segmentId, rainfall1h, rainfall3h, rainfall6h, rainfall24h, windSpeedKmh,
          roadCondition, terrainSlopeDeg, elevationM, historicalLandslides,
          historicalFloods, previousClosureFrequencyPct, trafficLevel }
  200: { riskProbability: number, riskScore: number, riskLevel: RiskLevel,
         topFactors: RiskFactor[], explanationText: string, modelVersion: string }
  // riskScore = round(riskProbability * 100) — deterministic conversion, always (review #14)
  // explanationText constraints (review #41): 1-2 sentences max, no markdown, references only
  // the supplied topFactors, no invented numbers. If Gemini call fails, use a deterministic
  // template: "Risk is elevated primarily due to {topFactor1} and {topFactor2}."

POST /internal/predict-delivery-risk
  body: { distanceRemainingKm, currentSpeedKmh, routeRiskScore, weatherSeverity,
          cargoPriority, hourOfDay, dayOfWeek }
  200: { failureProbability: number, expectedDelayMinutes: number, modelVersion: string }

POST /internal/vision/classify   (multipart/form-data)
  body: { image: File }
  200: { detectedClass: "LANDSLIDE" | "FLOOD" | "DEBRIS" | "DAMAGED_ROAD" | "BLOCKED_ROAD" | "NORMAL",
         confidence: number, estimatedBlockage: "NONE" | "PARTIAL" | "SEVERE" }
  // Prompt Gemini vision to return exactly this structured JSON (review #42, #7) —
  // do not accept free-text description as the response.
```

---

## 6. Formulas, conversions, and encodings (fixes review #14, #16, #17, #18, #19, #20, #44)

**6.1 Categorical encoding (must be identical in training and inference):**
```
roadCondition:   GOOD=0, FAIR=1, POOR=2
cargoPriority:   LOW=0, MEDIUM=1, HIGH=2, CRITICAL=3
```

**6.2 Coordinate order (review #13) — this is the #1 way to silently draw a route in the wrong place:**
```
Application/database/API (lat, lng everywhere in this contract): { lat, lng }
Leaflet:                    [lat, lng]
OpenRouteService request/response: [lng, lat]  ← reverse before sending, reverse back on response
```

**6.3 weatherSeverity — normalized 0-3 scale (review #17), computed server-side from the segment's latest WeatherSnapshot, not a raw field:**
```
0 = normal        (rainfall24h < 20mm)
1 = moderate       (20-60mm)
2 = severe         (60-110mm)
3 = extreme        (>110mm)
```

**6.4 predictedStockoutHours (review #18):**
```
if dailyConsumption <= 0:  predictedStockoutHours = null
elif currentStock <= 0:    predictedStockoutHours = 0
else:                      predictedStockoutHours = (currentStock / dailyConsumption) * 24
```

**6.5 Adjusted stockout after a delay (review #19):**
```
adjustedStockoutHours = max(0, baseStockoutHours - (expectedDelayMinutes / 60))
```
**StockoutEvent creation rule (review #4) — must check the previous value, not just the new one, or repeated cascade runs will spam duplicate events:**
```
IF previousAdjustedStockoutHours >= 48 AND newAdjustedStockoutHours < 48:
    → CREATE StockoutEvent (this is a genuine crossing into CRITICAL)
ELSE:
    → no event, regardless of how low or high the new value is

Examples:
  100 → 40   CREATE  (crossed from safe into critical)
  40  → 30   NO EVENT (already critical, still critical — not a new crossing)
  30  → 60   NO EVENT (recovered — recovery is not itself an event for MVP)
  60  → 40   CREATE  (crossed again after recovering)
```
`previousAdjustedStockoutHours` is read from the InventoryItem row's value *before* this cascade run recomputes it — compute new value first, compare, write StockoutEvent if the rule matches, then update InventoryItem.predictedStockoutHours.

**6.6 topFactors / SHAP normalization (review #39, #40):**
```
1. Take SHAP values for the prediction, sort by absolute magnitude descending.
2. Take the top 4-5.
3. contributionPct = round(abs(shapValue) / sum(abs(all shapValues shown)) * 100)
4. contributionPct is a display-only normalization across the SHOWN factors — it is not
   required to sum to 100 across ALL features, only across the ones returned.
```

**6.7 Nearest-segment matching (review #7, #45) and route-to-segment matching (review #44):**
```
Incident → segment: nearest RouteSegment by straight-line distance from (incident.lat, incident.lng)
  to the segment's midpoint, within a 5km tolerance. Beyond 5km, leave segmentId null.

ORS route → segments: for a candidate route's geometry, find every RouteSegment whose midpoint
  falls within 5km of any point on the route polyline. Store these as Route.segmentIds, in the
  order they appear along the route.

Route.riskScore = average(lastRiskScore of each segment in segmentIds), with the single
  highest-risk segment in the list acting as a tie-breaker when two candidates average closely
  (within 5 points of each other) — prefer the candidate whose worst segment is less risky.

Route.name: assign "Route A", "Route B", "Route C" in the order candidates are returned
  (lowest riskScore first, so "Route A" is always the recommended one), each suffixed with
  the roadType shared by most of its segmentIds, e.g. "Route A — Highway Corridor" or
  "Route B — State Road Alternate". This is a display label only, not a real road name.
```

**6.8 Incident image handling (review #31):**
```
The uploaded image is sent directly to /internal/vision/classify and never persisted to disk
or cloud storage for MVP. imageUrl stays null. Do not add S3/Cloudinary/Supabase Storage.
```

**6.9 Pre-positioning score (review #20) — lower is better:**
```
distanceScore = warehouseDistanceKm / maxDistanceAmongCandidates   // normalized 0-1
riskScore_norm = averageRouteRiskToWarehouse / 100                 // normalized 0-1
prePositionScore = 0.5 * distanceScore + 0.5 * riskScore_norm
```

**6.10 Twilio notification channels and recipient priority (review #5, voice call addition):**
```
Channel trigger rule:
  HIGH severity Alert      → SMS only
  CRITICAL severity Alert  → SMS + Voice Call (both attempted)
  LOW/MEDIUM severity      → no Twilio notification (unchanged from before)

Recipient priority — IDENTICAL for both channels, resolved once per alert and reused for
both the SMS and the Voice Call attempt:
  1. the assigned vehicle's driverPhone, if present
  2. else the FIELD_OFFICER covering that district, if present
  3. else no notification is attempted on any channel — store the Alert with
     notifiedViaTwilio = false, smsStatus/callStatus = "NOT_ATTEMPTED" — do not fail the request

Voice call content (review #11): a simple one-way TwiML `<Say>` announcement reading the
Alert's title + message aloud — e.g. "Critical alert. Route 17 disruption risk 87 percent
due to heavy rainfall. Reroute via Route B recommended." No IVR menu, no gather/input step,
no conversational AI, nothing that expects the recipient to respond. This is a notification,
not a call center.

This extends the existing Twilio integration and cascade/notification function — it is NOT a
new endpoint or a separate notification pathway (review: "no duplicate endpoints"). The same
function that already sends the SMS now also places the voice call when severity is CRITICAL,
using the same resolved recipient and the same Alert row.
```

**6.11 Resilience rules (review #24, #25, #26) — a downstream failure must never fail the whole cascade:**
```
Twilio fails  → Alert is still created either way. SMS and Voice Call are attempted and recorded
  independently: each sets its own smsStatus/callStatus to "FAILED" (not "NOT_ATTEMPTED") if the
  channel was attempted but the Twilio API call errored, and the corresponding SID field stays
  null. One channel failing does not block attempting the other. notifiedViaTwilio = true if
  EITHER channel succeeded, false only if both failed or neither was attempted. The cascade and
  the underlying risk/decision operation must never fail or roll back because Twilio (SMS or
  Voice) failed (voice call addition — see 6.10).
Gemini fails  → return riskScore/riskLevel/topFactors with the deterministic template explanation (5, /internal/predict-risk).
ORS fails     → /api/routes/candidates returns 503; do not fabricate geometry.
External API calls (Twilio/Gemini/ORS) must NOT run inside a database transaction (review #37) —
  wrap only the DB writes in a Prisma transaction, call external APIs before or after it.
```

**6.12 GPS anomaly detection (review #34, #35):**
```
Require at least 2 consecutive readings (no historical baseline needed for MVP).
If currentSpeed < expectedSpeedKmh * 0.4 for 2+ consecutive updates → create alert.
Cooldown: do not create another anomaly alert for the same vehicle within 10 minutes
  unless the condition cleared (speed recovered) and reappeared.
```

**6.13 RouteCandidate `topFactors` / `explanationText` derivation (review: gap found in final reverification pass) — a route candidate is NOT independently re-scored by SHAP/Gemini:**
```
POST /api/routes/candidates does not call /internal/predict-risk again per candidate — that
would be redundant with the per-segment risk data already computed and stored on RouteSegment
(section 6.6). Instead, for each candidate, after segmentIds is resolved (section 6.7):

1. dominantSegment = the segment in this candidate's segmentIds with the highest lastRiskScore
   (the SAME segment already used as the tie-breaker segment in 6.7's Route.riskScore rule —
   reuse that lookup, don't recompute it separately).
2. topFactors = dominantSegment.lastRiskFactors, copied through unchanged (same RiskFactor[]
   shape, already normalized per 6.6). If dominantSegment.lastRiskFactors is null (no risk
   prediction has run for it yet), topFactors = [].
3. explanationText — built deterministically, NO new Gemini call per candidate (keeps candidate
   generation fast, since 2-3 candidates come back from one request):
   "Route risk is primarily driven by {dominantSegment.name}, where {topFactor1.factor} and
   {topFactor2.factor} keep segment risk at {dominantSegment.lastRiskScore}."
   Use only the top 1-2 entries of topFactors by contributionPct. If topFactors is empty,
   explanationText = "Risk data not yet available for this route's segments."
```

**6.14 Decision Engine action → `Alert.severity` mapping (review: gap found in final reverification pass) — connects `/api/ai/decision`'s output to the Twilio channel rule in 6.10, using ONLY the threshold tables already defined in section 2 (no new thresholds invented):**
```
When the cascade calls the Decision Engine and gets back an action other than NONE, it creates
an Alert with severity set as follows:

REROUTE       → Alert.severity = the riskScore bucket (section 2) of routeRisk.
                REROUTE only fires when routeRisk >= 70, so this is always HIGH or CRITICAL.

PRE_POSITION  → Alert.severity = the stockout-urgency bucket (section 2) of adjustedStockoutHours,
                mapped onto the Severity enum: the "CRITICAL" stockout bucket (<48h) → Alert
                severity CRITICAL; the "WARNING" bucket (48-96h) → Alert severity HIGH.
                PRE_POSITION only fires when adjustedStockoutHours < 48 (i.e. always the
                CRITICAL stockout bucket per the decision rule in section 4), so in practice
                this always resolves to Alert.severity = CRITICAL. The WARNING branch exists
                only for correctness if this mapping is ever reused at a different threshold —
                it should not currently be reachable from the Decision Engine's own if/else.

ALERT         → Alert.severity = the failureProbability bucket (section 2) of failureProbability.
                ALERT only fires when failureProbability >= 0.85, so this is always CRITICAL.

NONE          → no Alert is created at all.

This is what guarantees the "guaranteed demo cascade" (section 7): a genuine <48h stockout
crossing that triggers PRE_POSITION always maps to Alert.severity = CRITICAL, which is what
makes 6.10 fire both SMS and the Voice Call, not just SMS.
```

**6.15 Twilio Voice Call delivery mechanism (review: gap found in backend-vs-contract reverification pass) — locks HOW the TwiML reaches Twilio, which 6.10 never specified:**
```
Two ways exist to give Twilio the words to speak on a Voice Call: pass the TwiML inline as the
`twiml` parameter on `calls.create()`, or pass a `url` parameter pointing at a publicly
reachable endpoint that RETURNS the TwiML when Twilio fetches it.

Empirically verified during Phase 5 against a real (at the time, trial) Twilio account:
inline `twiml` is REJECTED ("disallowed on trial"); `url` is the shape Twilio accepts.

DECISION: use the `url` parameter, not inline `twiml`. This requires:
  1. A tiny internal-only route, e.g. GET /internal/twiml/voice-alert?title=...&message=...&
     severity=..., that returns the same <Response><Say>...</Say></Response> XML
     `buildVoiceTwiml()` already generates — just served over HTTP instead of passed inline.
     This route needs no auth (Twilio's fetcher can't send a bearer token) but should not leak
     anything beyond what the Alert's title/message already say.
  2. A PUBLIC_BASE_URL environment variable — the publicly reachable origin (ngrok tunnel URL
     during development/demo, since this runs on localhost) that Twilio can reach to fetch that
     route. `calls.create()` then passes `url: `${PUBLIC_BASE_URL}/internal/twiml/voice-alert?...`
     instead of `twiml: buildVoiceTwiml(...)`.
  3. `buildVoiceTwiml()` itself is unchanged — only how its output reaches Twilio changes.

This was flagged during Phase 5 as needing resolution "alongside the account" but the code
still passes `twiml` inline as of this review — fix this before relying on Voice Calls working,
independent of whatever Twilio account tier is active, since the `url` shape is what Phase 5's
own diagnostic run confirmed works.
```

**6.16 Three smaller implementation decisions found during the backend-vs-contract reverification pass — recorded here since none of section 3's public response shapes change:**
```
1. AIRecommendation write targets for PRE_POSITION. The contract states how GET
   /api/deliveries/:id and GET /api/districts/:id each read back the latest matching
   AIRecommendation row, but never states which target(s) the cascade writes to per action.
   Decision: REROUTE and ALERT write one row, targetType="DELIVERY". PRE_POSITION writes TWO
   rows — targetType="DISTRICT" (so Supply Intelligence's row-expand has something to show)
   AND targetType="DELIVERY" (so Delivery Intelligence does too) — same recommendationText,
   same confidence, same createdAt window, since it's one decision surfaced on two pages.

2. saferRouteExists does not trigger a fresh ORS call when no candidates are cached. Section 4
   says "re-run candidates if none cached" for POST /api/ai/decision's saferRouteExists check.
   The implementation instead treats saferRouteExists as false when no cached Route rows exist
   for that origin/destination pair, rather than calling generateRouteCandidates() synchronously
   inside the Decision Engine. Rationale: an ORS call inside what's meant to be fast
   deterministic branching adds latency, consumes ORS free-tier quota unpredictably, and
   introduces a new external-API failure mode into an endpoint section 4 explicitly describes
   as "no LLM call needed here, this is deterministic branching." PRACTICAL EFFECT: for any
   delivery whose Route Intelligence page was visited at least once (which includes
   DEL-1001/the guaranteed demo path, since visiting that page is how a route gets assigned in
   the first place), candidates are already cached and this limitation never triggers. It only
   matters for a delivery that reaches the Decision Engine (e.g. via the cascade) without ever
   having had /api/routes/candidates called for it.

3. Alert.relatedType gets a fifth value, "VEHICLE", for GPS anomaly alerts (contract section
   6.12) — used internally for the dedup key and for context, alongside the four documented in
   section 3 ("DELIVERY" | "ROUTE" | "DISTRICT" | "INCIDENT"). This does not affect any public
   API response: relatedType/relatedId are never exposed on the public Alert type (section 3
   explicitly withholds them), so no frontend type or page needs to account for a fifth value.
   Documented here purely for backend-internal consistency.
```

**6.17 `currentEta` and `expectedDelayMinutes` are linked (gap found post-merge):**
```
Delivery.currentEta is the PREDICTED arrival time and must be recomputed by the cascade
whenever expectedDelayMinutes changes:

    currentEta = requiredEta + expectedDelayMinutes minutes

Recomputed from requiredEta on every cascade run, never accumulated onto the previous
currentEta — this keeps repeated cascade runs idempotent. A delivery with no delay
prediction has expectedDelayMinutes = null and currentEta = requiredEta, which is the
seeded/created state. A delivery is "late" exactly when expectedDelayMinutes > 0.
```

## 7. Seed data requirements (review #46, #67)

- **Geography must be coherent, not random** — the whole demo depends on ORS routes actually passing near seeded segments. Use one real corridor, e.g. Guwahati → Tezpur → Bomdila → Tawang, and place all seeded RouteSegments, Districts, and Warehouses along it.
- **Seed order** (dependencies matter): Users → Districts → Warehouses → RouteSegments → Vehicles → Deliveries → InventoryItem → WeatherSnapshot → Incident → (optionally) an initial RiskPrediction pass.
- **Incident** is seeded (added post-merge): without it the Incident Center and Field Operations "Recent activity" panels open empty. Seed 6-9 incidents along the corridor with a spread of types and severities, `createdAt` staggered over the past few days, `imageUrl` null per section 6.8, and `cvDetectedClass`/`cvConfidence`/`cvEstimatedBlockage` populated as though already classified. Seeded incidents must NOT be placed on `DEMO_SEGMENT_ID` in a state that pre-triggers the cascade or shifts its baseline risk score — the guaranteed-demo-cascade checkpoint below must still pass afterward.
- **Value ranges used for RouteSegment fields must match the ranges used in Phase 3's synthetic ML training data** (e.g. `historicalLandslides` 0-15, `rainfall24h` 0-150mm) — write these ranges down when seeding so Phase 3 can reuse them exactly.
- Designate one seeded segment as `DEMO_SEGMENT_ID` for the simulate-rain button default (section 4).

**Guaranteed demo cascade (review #5) — do not leave the "wow moment" to chance on synthetic-model output:**
```
DEMO_SEGMENT_ID's seeded feature values, at rest, must score in the 30-45 riskScore range
  (NORMAL/LOW-MEDIUM) when run through the trained model as-is.

POST /api/demo/simulate-rain on DEMO_SEGMENT_ID writes a WeatherSnapshot with rainfall values
  high enough (per the weighted formula in Phase 3, section on ML training) to push the
  same segment's riskScore into the 85-95 range (CRITICAL) when re-scored — this is not
  optional tuning, it's a checkpoint: after seeding, actually run DEMO_SEGMENT_ID through
  /internal/predict-risk once at baseline and once with the simulate-rain weather values,
  and confirm both land in their target bands before moving on.

At least one seeded Delivery must be assigned a Route whose segmentIds includes
  DEMO_SEGMENT_ID, so the risk spike has a delivery to propagate to.

That delivery's destination District must have at least one InventoryItem whose
  predictedStockoutHours, once adjusted by the resulting expectedDelayMinutes (section 6.5),
  crosses below 48h — tune dailyConsumption/currentStock at seed time so this happens
  reliably, not by chance. This is what guarantees PRE_POSITION fires and Twilio sends both
  the SMS and the Voice Call during every rehearsal and the actual judged run, not just some
  of the time (voice call addition — see 6.10; the underlying stockout/decision logic that
  produces the CRITICAL alert is unchanged).
```

---

## 8. Environment variables (review #53)

```
DATABASE_URL=
JWT_SECRET=
GEMINI_API_KEY=
ORS_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
ML_SERVICE_URL=
PUBLIC_BASE_URL=
```
`PUBLIC_BASE_URL` (added — see 6.15) is the publicly reachable origin (an ngrok tunnel URL
during development/demo) that Twilio's Voice Call fetches TwiML from via
`GET /internal/twiml/voice-alert`. Required for Voice Calls to work at all — inline TwiML is
rejected by Twilio (verified empirically in Phase 5), so this is not optional.
`TWILIO_FROM_NUMBER` (renamed from `TWILIO_PHONE_NUMBER`) is the single sender number used as
the Twilio "From" for both SMS and Voice Call — one number serves both channels, no second
number needed.
External API calls (Gemini/ORS/Twilio) use a 10-15 second timeout (review #73). CORS must be enabled on Node for the Vite dev origin (review #74).

---

## 9. Pages (for Cursor's reference — see full prompt in CURSOR_PROMPT.md)

1. Login
2. Command Center (dashboard home)
3. Live Logistics Map
4. Delivery Intelligence
5. Route Intelligence
6. Incident Center
7. AI Risk Center
8. Supply Intelligence
9. Field Operations
10. Analytics

---

## 10. Non-negotiable rules for both tools

- Never invent a field not in this document. If something's missing, flag it and this file gets updated first.
- All dates are ISO strings over the wire.
- All risk/probability scores: `riskScore` is an integer 0–100; `riskProbability` / `failureProbability` / `confidence` are floats 0–1. Conversion is always `riskScore = round(riskProbability * 100)`.
- `riskLevel` and any risk-bucket field is always the strict union `"LOW" | "MEDIUM" | "HIGH" | "CRITICAL"` — never a bare `string`, in types or in API responses.
- Every list endpoint returns `{ resourceName: [...] }`, never a bare array.
- Auth: every protected route expects `Authorization: Bearer <token>`; a 401 always returns `{ error: string }`.
- Model artifacts are named descriptively (`route-risk-xgb-v1`, `delivery-risk-xgb-v1`), never a bare version string, and loaded from a project-relative path — never a hardcoded absolute path (review #76, #77).
- Do not optimize for or advertise high accuracy numbers on the synthetic-label models — the labels come from a documented formula, so near-perfect accuracy is expected and meaningless as a claim. The credible story is feature sensitivity + explainability + a working end-to-end cascade (review #80).
- Claude Code may modify implementation freely but may NOT change the schema, API shapes, enum values, or add an external service without editing this file first (review #81).
