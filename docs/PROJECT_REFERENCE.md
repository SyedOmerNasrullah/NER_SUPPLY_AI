NER-SupplyAI
Final Consolidated Project Reference
SIH26002 — AI-Based Smart Logistics and Accessibility Intelligence Platform for the North Eastern Region
Vibe-Coding Edition, v2 (Postgres + Twilio)
This is the single source of truth for the build. It merges the original full blueprint with the MVP-filtered version discussed afterward, closes the gaps between them (mainly: a proper relational schema for the Postgres decision, and a few sections the filtered version had trimmed too far), and adds one new feature: Twilio SMS/Call alerting. Everything here is realistically buildable by Cursor (frontend) + Claude Code (backend/ML) inside a 2–3 day window. Anything not achievable that way has been explicitly cut — see Section 10.
1. The Problem, in One Scenario
A truck is carrying emergency medicines from Guwahati to a district hospital. A normal map shows one road. NER-SupplyAI also knows: heavy rainfall is forecast, a landslide has occurred historically on one stretch of that road, the road's condition has deteriorated, and the cargo is high priority. Instead of waiting for the road to actually close, the system says, ahead of time:
Delivery disruption probability: 86%
Recommended action: Reroute through Route B
Route A → Risk 86%, ETA 7h20m
Route B → Risk 31%, ETA 6h55m
AI Recommendation: USE ROUTE B
That's the whole product: not a map, but a system that predicts trouble before it happens and tells the operator what to do about it — then, new this round, tells the right human by phone or SMS, not just on a dashboard they might not be looking at.
One-sentence positioning: NER-SupplyAI is not a navigation system that tells you where a vehicle is; it is an AI supply-continuity system that predicts when an essential delivery is likely to fail, recommends what action should be taken before it does, and makes sure the right person is actually notified.
2. Final Tech Stack
Layer
Technology
Why
Frontend
React + Vite + TypeScript
Simpler than Next.js for a login-gated internal dashboard; no SSR complexity to fight with AI-generated code
UI
Tailwind CSS + shadcn/ui
Fast, consistent, plays well with AI code generation
Maps
Leaflet or MapLibre GL
Free, no API key needed for basic tile rendering
Routing (alt routes)
OpenRouteService (free tier) or Google Directions API
Avoids self-hosting OSRM/GraphHopper
Backend
Node.js + Express
Auth, CRUD, orchestration, talks to both the ML service and Twilio
Database
PostgreSQL + Prisma ORM
Type-safe schema shared cleanly across two AI tools; relational shape fits deliveries/routes/inventory well and avoids a second exotic system to debug under time pressure
Real-time
Socket.IO
Live vehicle position + alert updates
ML Service
Python + FastAPI
Serves XGBoost models + SHAP explanations
ML Models
XGBoost (trained on synthetic + open data)
Route risk, delivery delay, stockout — tabular, explainable, fast to train
Explainability
SHAP
Turns model output into "why" factors
Natural-language explanation
Claude or Gemini API
Narrates SHAP output in plain English — explains the decision, never makes it
Incident photo analysis
Claude (vision) or Gemini (vision)
Classifies landslide/flood/debris/normal — no custom CV training needed
Notifications
Twilio (SMS + Voice)
Pushes critical alerts to a phone directly — see Section 6
Auth
JWT
4-role access control
Deployment
Vercel (frontend) + Render/Railway (backend + ML) + Neon/Supabase (Postgres)
Free/cheap tiers, fine for a hackathon demo

Why Postgres over MongoDB for this build
The original blueprint spec'd Mongo for its native 2dsphere geospatial indexing, and that's a real strength for polygon/intersection queries. But almost everything this project actually needs geospatially — "nearest warehouse," "vehicles near an incident," "is this point in this district" — is doable with PostGIS-lite functions or even simple haversine math in application code at hackathon scale, and a relational schema is easier for two separate AI coding tools to stay in sync on because Prisma's schema file is the contract. Mongo's flexible-schema advantage matters most when your data is genuinely variable-shaped (which incidents/deliveries are, a little) — that's handled here with nullable columns and a couple of JSON columns for the truly variable bits (SHAP factor breakdowns, CV analysis results), rather than switching the whole database.
3. Do You Need API Keys?
Anthropic API key (console.anthropic.com): needed if you use Claude for SHAP-narration and/or incident photo classification. This is billed separately from your Claude Pro/Max subscription — the subscription does not include API credits.
Gemini API key (Google AI Studio): a genuinely free alternative for both jobs above, with rate limits meant for prototyping — more than enough for a hackathon demo's call volume. Recommended as primary, with a small Anthropic budget kept as backup in case free-tier quota enforcement is flaky (test this early).
Twilio: free trial account gives you a real phone number, a small SMS/call credit, and console SID/Auth Token — enough to demo real SMS/call alerts without paying anything. Verify the demo phone number in the Twilio console ahead of time (trial accounts can only send to verified numbers).
OpenRouteService (or Google Directions): free tier API key for generating 2–3 candidate routes between two points.
Weather API: any free-tier provider (OpenWeatherMap, WeatherAPI, etc.) for rainfall/wind/visibility.


4. AI / ML Architecture
4.1 Four models, not fifteen
Model
Inputs
Output
Route Risk Predictor
Rainfall (1h/3h/6h/24h), road condition, terrain slope, elevation, historical incidents, traffic, season, distance to river, closure frequency
Risk score 0–100, risk level, predicted disruption type
Delivery Failure Predictor
Vehicle location, distance remaining, current speed, route risk, weather, cargo priority, deadline, historical delay
Late probability, expected delay minutes
Supply Shortage Predictor
Current stock, daily consumption (forecast), delivery ETA, delivery failure probability
Predicted stockout time, severity
Incident Vision
Uploaded photo
Detected class (landslide/flood/debris/damaged road/normal), confidence
All four are XGBoost (classification and/or regression) except Incident Vision, which is a vision LLM call — no custom CV training. Every model run is logged (see risk_predictions / ai_recommendations tables) so the Analytics page has real history to chart.
4.2 The explicit risk formula (start here, then let ML refine it)
Risk Score = 30% Weather + 25% Road condition + 20% Historical disruptions
           + 15% Terrain + 10% Traffic
Showing judges this explicit baseline — and that XGBoost + SHAP refine it — is what makes the system defensible as "the LLM explains a real model's decision," not "an LLM guessing a number."
4.3 Master Decision Engine
A simple, explainable if/else layer that combines the three predictive models' outputs into one ranked, human-readable action:
Is the route safe?
Will the delivery arrive on time?
Will the destination face a shortage?
Is another candidate route better?
Should inventory be pre-positioned?
Is this severe enough to page a human directly (SMS/call), or is a dashboard alert enough? (new — see Section 6)
ACTION: REROUTE + PRE-POSITION + NOTIFY (SMS)
Confidence: 91%
Reason: Current route has 86% disruption probability; hospital
inventory may fall below safety stock before the delivery arrives.
4.4 Demo reliability: live + simulated weather
Don't depend on real weather cooperating during a judging slot. Build a "Simulate Heavy Rainfall" control that overwrites the weather inputs and re-triggers the full cascade (route risk → delivery risk → supply risk → decision engine → notification). This single control is what makes the live demo both reliable and dramatic.
4.5 The incident → cascade → notify chain
Officer uploads incident photo
   ↓
Vision LLM classifies (landslide / flood / debris / normal)
   ↓
Road segment status updated
   ↓
Route risk recalculated → Delivery risk recalculated → Supply risk recalculated
   ↓
Decision Engine picks an action
   ↓
Dashboard alert fires + (if critical) Twilio SMS/Call fires
This closed loop — reasoning across four layers from one uploaded photo — is the strongest single moment in the demo.


5. Database Schema (PostgreSQL / Prisma)
Relational equivalent of the original Mongo collections. Genuinely variable-shaped fields (SHAP factor breakdowns, CV analysis output) are kept as Json columns rather than forcing them into rigid columns.
Table
Key columns
users
id, email, passwordHash, role (admin | logistics_officer | field_officer | district_officer), phoneNumber (for Twilio)
vehicles
id, code, lat, lng, speedKmh, expectedSpeedKmh, speedHistory (Json array), currentDeliveryId, currentRouteId, status
drivers
id, name, vehicleId, phoneNumber
route_segments
id, segmentCode, geometry (Json — LineString coords), terrainSlopeDeg, elevationM, roadCondition, roadType, distanceToRiverKm, historicalLandslides, historicalFloods, previousClosureFreqPct, currentStatus, lastRiskScore, lastRiskFactors (Json), updatedAt
routes
id, deliveryId, segments (relation), distanceKm, etaMinutes, riskScore, isRecommended
deliveries
id, code, cargoType, priority, originLat/Lng, destinationLat/Lng, assignedRouteId, requiredEta, currentEta, failureProbability, expectedDelayMinutes, severity, status
incidents
id, lat, lng, segmentId, type, severity, reportedById, description, imageUrl, cvAnalysis (Json: detectedClass, confidence, estimatedBlockage), createdAt
weather_snapshots
id, segmentId, rainfall1h/3h/6h/24h, windKmh, visibility, capturedAt
road_conditions
id, segmentId, condition, source, updatedAt
risk_predictions
id, segmentId/deliveryId, modelVersion, inputFeatures (Json), riskScore, shapFactors (Json), createdAt — append-only audit log, also feeds Analytics
alerts
id, type, severity, message, relatedEntityId, notifiedVia (dashboard | sms | call | both), acknowledged, createdAt
notifications
id, alertId, channel (sms | call), recipientUserId, recipientPhone, twilioSid, status, sentAt — new table for the Twilio feature
districts
id, name, lat, lng, boundary (Json polygon, optional)
warehouses
id, name, lat, lng
inventory
id, warehouseOrDistrictId, item, currentStock, dailyConsumption, predictedDailyConsumption (Json array), predictedStockoutHours, lastRestockedAt
suppliers
id, name, contact
ai_recommendations
id, type (reroute | prepositioning | notify), payload (Json), confidence, createdAt — append-only log

Geospatial queries at this scale (nearest warehouse, vehicles near an incident, point-in-district) are handled with straightforward haversine-distance SQL/Prisma queries rather than a dedicated GIS extension — plenty fast for a few hundred rows in a demo dataset.


6. New Feature — Twilio SMS / Call Alerts
Why it belongs in this project: every other feature already produces a well-formed, severity-ranked alert (Section 4.3, Feature #12 below). Twilio is just the last mile — turning "a critical alert exists in the database" into "a real phone rings or buzzes." It's a small, self-contained REST integration (a handful of Node calls to Twilio's API), which makes it low-risk for vibe coding and a genuinely strong demo beat: judges seeing an actual phone light up lands harder than another dashboard toast notification.
How it works
The Decision Engine (Section 4.3) or the alert-ranking logic (Feature #12) marks an alert as CRITICAL.
Backend looks up the right recipient by role/context — e.g. the assigned Logistics Officer for a reroute recommendation, or the District Officer for a stockout alert — and their phoneNumber.
Node backend calls the Twilio REST API:
SMS for most critical alerts (reroute recommended, stockout predicted, incident confirmed).
Voice call (Twilio's programmable voice, reading a short TwiML message) reserved for the single most severe class — e.g. "delivery failure probability above 90% with no viable reroute" — so it doesn't feel spammy.
A row is written to the new notifications table (channel, recipient, Twilio SID, delivery status), so the Field Operations / Analytics pages can show "alert sent, delivered, acknowledged."
A toggle per alert type (SMS / Call / Dashboard-only) lives in a small Notification Settings panel — simplest as a section on the Field Operations page (Page 9) rather than a whole new page.
Where it shows up
Command Center (Page 2): critical alerts in the priority feed show a small "📲 SMS sent" / "📞 Calling…" badge next to the alert.
Incident Center (Page 6): submitting a high-severity incident (e.g., confirmed landslide, severe blockage) triggers an SMS to the relevant Logistics/District Officer as part of the cascade.
Route Intelligence (Page 5) / Delivery Intelligence (Page 4): a manual "Notify officer now" button next to the AI recommendation, for the demo moment where the presenter wants to trigger it live on cue.
Field Operations (Page 9): the Notification Settings panel, plus a log of recent notifications and their delivery status (pulled from the notifications table).
Feasibility note
This is genuinely one of the easiest features on the list to vibe-code — Twilio's Node SDK is a thin wrapper around a couple of REST calls (client.messages.create(...), client.calls.create(...)), and the trial account is free. The only manual step a human has to do (not an AI tool) is verifying the demo phone number in the Twilio console beforehand, since trial accounts restrict sending to unverified numbers.


7. Pages, Features, and Design
Page 1 — Login
Features: Email/password login, JWT session, role-based redirect (Admin / Logistics Officer / Field Officer / District Officer).
Design: Clean, minimal, government-tool feel — centered card, logo, two fields, one button.
Page 2 — Command Center ⭐ (first page judges see)
Features:
Summary stat cards: Active Deliveries, At-Risk Deliveries, Critical Alerts, Road Blockages
Live map widget (embedded) showing vehicle positions + risk zones
Prioritized AI alert feed, ranked by severity — critical entries show the SMS/Call notification badge
Design: Top row of 4 stat cards; map left ~60% width; alert feed right ~40%, scrollable.
Page 3 — Live Logistics Map (full screen)
Features: Full-screen map — live-updating vehicles (Socket.IO), risk-zone overlays, blocked-road markers, delivery destinations. Click a vehicle → popup with cargo, speed, ETA, risk %, link to full AI analysis.
Design: Map fills the screen; floating top-left filter panel to toggle layers (vehicles / risk zones / incidents / weather).
Page 4 — Delivery Intelligence
Features: Delivery details (origin, destination, cargo, priority); AI delivery risk score; expected delay + failure probability; plain-English AI recommendation; manual "Notify officer now" button.
Design: Two-column — left: delivery info card; right: large radial/gauge risk chart + recommendation box.
Page 5 — Route Intelligence ⭐ (showcases the core AI feature)
Features: 2–3 candidate routes side by side, each with distance/ETA/risk; AI-recommended route highlighted; click a route → SHAP "why" breakdown + LLM explanation sentence; manual notify button.
Design: 3 cards side by side, recommended one visually highlighted; below, expandable "Why this route?" panel with a horizontal bar breakdown of contributing factors.
Page 6 — Incident Center
Features: Incident report form (GPS or manual pin, type, severity, description, photo upload); on submit, photo → vision LLM → detected class + confidence; submission triggers the full cascade (route → delivery → supply risk) and, if severity is high, an SMS to the relevant officer.
Design: Form on the left; AI analysis result card on the right after submission (checklist-style: ✓ Landslide detected, ✓ Severe blockage, confidence %), with a "🔔 Officer notified via SMS" line when triggered.
Page 7 — AI Risk Center
Features: All monitored routes/segments, risk-sorted; summary chart of top contributing factors overall (rainfall, terrain, history, road condition, traffic); click a route → full SHAP + LLM narration.
Design: Table/list with a color-coded horizontal risk bar per row; summary chart pinned at the top.
Page 8 — Supply Intelligence ⭐ (strongest differentiator)
Features: Grid of districts × supply categories (medicine/food/fuel) with status indicators; click a district → current stock, daily consumption, predicted stockout time (delay-adjusted), AI pre-positioning recommendation ("Transfer 100 units from Warehouse B").
Design: Grid/table main view; drill-down modal/side panel with stock gauge, consumption trend line, and recommendation card.
Page 9 — Field Operations
Features: List of field officers with current location/status; recent incident report feed; Notification Settings panel (per-alert-type SMS/Call/Dashboard-only toggle) and a recent notifications log (channel, recipient, delivery status).
Design: Two-panel list layout — officers on the left, activity feed on the right; notification settings + log as a third section below or a side drawer.
Page 10 — Analytics
Features: Historical charts — delivery success rate, average delay, most-flagged routes, district shortage frequency, and (new) notification delivery/response stats — pulled from risk_predictions, ai_recommendations, and notifications.
Design: Grid of chart cards (Recharts, line/bar), filterable by date range.


8. Feature List — What's Actually Being Built (MVP, Filtered)
#
Feature
How it's actually built
Page(s)
1
Route risk scoring
XGBoost model on synthetic + open data
Route Intelligence, Risk Center
2
Risk explainability
SHAP values → Claude/Gemini narrates in plain English
Route Intelligence, Risk Center
3
Alternate route comparison
Routing API (OpenRouteService) generates candidates, risk model scores each
Route Intelligence
4
Delivery delay/failure prediction
XGBoost, same synthetic-data approach
Delivery Intelligence
5
Supply shortage/stockout prediction
Arithmetic (stock ÷ consumption, delay-adjusted) + small regression forecast
Supply Intelligence
6
Pre-positioning recommendation
Scored comparison across 2–3 warehouses (distance × risk)
Supply Intelligence
7
Incident photo classification
Vision LLM call (Claude or Gemini), no custom training
Incident Center
8
Incident → cascading recalculation
New incident updates a feature value → same models re-run
Incident Center → ripples to Route/Delivery/Supply
9
Real-time vehicle tracking
Socket.IO + simulated movement (or real GPS if available)
Live Map, Command Center
10
GPS anomaly detection
Rolling speed-average threshold rule
Live Map (flagged in alerts)
11
Prioritized alerts
Rule-based severity ranking
Command Center
12
Master Decision Engine
If/else rules combining models 1, 4, 5 (+ notify decision) into one recommendation
Behind Delivery/Route/Supply pages
13
Demo simulation control
"Simulate heavy rainfall" button, updates weather inputs, triggers cascade
Command Center (demo panel)
14
4-role auth
JWT + role field + route guards
Login, all pages
15
Twilio SMS/Call alerts
Node + Twilio SDK, triggered by critical alerts from the Decision Engine
Command Center, Incident Center, Route/Delivery Intelligence (manual trigger), Field Operations (settings + log)

Explicitly cut (unchanged from the earlier filtering pass, plus the Mongo/Postgres note above): self-hosted OSRM/GraphHopper routing engine, custom-trained CV model for landslide detection, live model retraining, a dedicated document database (Postgres covers this project's actual query needs), offline field reporting, multilingual alerts (optional stretch only), advanced anomaly-detection models beyond a rolling threshold.
9. User Roles
Role
Can do
Admin
Manage districts, users, vehicles; view everything; manage notification settings
Logistics Officer
Create deliveries, monitor vehicles, view route recommendations, receives reroute SMS/calls
Field Officer
Report incidents, upload photos, update road conditions
District Officer
View district supply status, manage emergency resources, receives stockout SMS/calls


10. The Demo Story
Create an emergency delivery: medicine → District Hospital. Vehicle begins journey, risk 21%.
Presenter hits Simulate Heavy Rainfall.
AI predicts: route risk 21% → 87%. System explains: "Heavy rainfall + historical landslide zone + poor road condition."
AI calculates alternatives — Route A 87%, Route B 32%, Route C 64% — and recommends Route B.
The Logistics Officer's phone buzzes with an SMS: "Route risk critical on Delivery NE-102 — reroute to Route B recommended."
Meanwhile, Supply Intelligence reports the destination hospital will run out of medicine in 32 hours because of the added delay.
AI recommends pre-positioning 100 units from a nearby warehouse — the District Officer gets a second SMS.
The judge sees the full picture: the system predicted the disruption → understood its downstream impact → recommended a reroute → actually notified a human by phone, not just a dashboard → protected the supply chain.
That's one continuous cascade, not a feature tour — and now it ends with a phone ringing, not just a screen updating.
