# NER-SupplyAI — Demo Runbook

One page, for use under pressure.

**Scope.** Sections 1-4 describe the **frozen frontend build** (`web/`), which is what you
present. It runs standalone against the deterministic demo adapter — no database, no Node API,
no ML service, no Twilio, no network. Sections 5-8 are retained from the earlier full-stack
build and apply only once Phase 4 wires a real backend; **nothing in them affects the demo you
are about to give.**

Every number in sections 2-4 was read off the running build during the Phase 3F verification
pass. All of them are derived from the shared demo world, so the figures on any two screens
agree by construction rather than by coincidence.

---

## 1. Start-up

### Demo mode — what you present

```bash
cd "E:\Desktop\NEW SIH NER\web"
npm run dev
```

One process, port **5173**. No database, no API, no network. There is no health check to perform
and no service that can silently fail underneath you.

This is the mode sections 2–4 describe and **the mode to use for the SIH demonstration**: every
action is instant, nothing can be unreachable, and the numbers are the frozen ones.

To present from the production build instead: `npm run build`, then
`npm run preview -- --port 4173`.

### HTTP mode — the real backend (Phase 4B onward)

```bash
cd "E:\Desktop\NEW SIH NER\api"
npm run dev            # port 4000; needs api/.env with DATABASE_URL and JWT_SECRET
```

Then set `VITE_DATA_SOURCE=http` in `web/.env` and restart the frontend.

Everything works — real bcrypt logins, the cascade, reroute and reset, all against PostgreSQL.
But **do not present from it against a remote database**, for three reasons that show on stage:

- **Speed.** Simulate takes ~10 s and reset ~7 s against Neon in us-east-2: each is one
  transaction of many round trips at roughly 500 ms apiece. Against a local PostgreSQL it is
  fast. If the database has been idle, Neon cold-starts and the first action takes far longer.
- **The clock is real.** Demo mode pins time to 18 Nov 2024; HTTP mode uses the wall clock, so
  the seeded alerts read "661d ago" instead of "18 min ago".
- **The demo-account panel is gone.** By design — a real backend publishes no credentials. Type
  `admin@ner.local` / `demo123`.

To present from HTTP mode, point `DATABASE_URL` at a local PostgreSQL and re-seed.

### The ML service (Phase 5A) — optional, not part of the presented demo

```bash
cd "E:\Desktop\NEW SIH NER\ml"
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then `ML_MODE=live` in `api/.env` and restart Express. **Allow ~25 seconds for it to start** —
almost all of that is Python loading its numerical libraries.

It changes nothing on screen: the route and segment scores the console displays are still the
frozen demo values. The model's own scores are available from `POST /api/ml/route-risk/score`
and compared in `docs/ML_REGRESSION_5A.md`. If asked "is the risk score real ML?", the honest
answer today is: *a real XGBoost model runs and explains every score with SHAP, trained on
synthetic data; the numbers on this screen are still the scripted demo values, and the two are
compared side by side in the regression report.*

---

## 2. Credentials

All four use password `demo123`. The login screen lists them; clicking a row fills the form.

| Account | Role | Sees | Can reset |
|---------|------|------|-----------|
| `admin@ner.local` | ADMIN | all nine modules — **use this to present** | **yes** |
| `logistics@ner.local` | LOGISTICS_OFFICER | all except Field Operations | no |
| `field@ner.local` | FIELD_OFFICER | Incident Center + Field Operations | no |
| `district@ner.local` | DISTRICT_OFFICER | Supply + Analytics | no |

The session is held in `sessionStorage`, so **a refresh keeps you signed in** — but it reloads
the module that holds the demo world, which **silently returns everything to baseline**. Use the
in-app tabs during the demo; do not refresh after you have run the cascade.

---

## 3. Reset before presenting

Press **Reset Demo**, top right of the header. It is visible to ADMIN only.

It is instant — the demo world lives in memory, so there is no seed to re-run and no service to
wait for. It restores weather, segment and route risk, delivery ETAs, stock levels and vehicle
positions, and clears every alert, recommendation, notification and incident filed during
rehearsal. All nine pages refresh in place; the browser does not reload.

> **There is no shelf life.** The demo clock is pinned to a fixed instant
> (Mon 18 Nov 2024, 10:24 IST) and nothing reads the wall clock, so a rehearsal at 09:00 and the
> real run at 14:00 produce byte-identical screens. Reset when you want a clean slate, not
> because time has passed.

---

## 4. The demo script

Sign in as `admin@ner.local`. Reset first if you have rehearsed.

### Baseline — what the judges should see before you touch anything

| Screen | Reads |
|--------|-------|
| Command Center KPI strip | Active **7** (3 at risk) · At-risk **3** (1 critical) · Road blockages **2** (0 major, 2 minor) · **Critical supply alerts 0** (0 districts) · Field officers **9 / 12** (75%) · Avg delay **1h 12m** (+6% vs yesterday) |
| Conditions | **Moderate Rainfall**, no simulation event |
| Route under assessment | **A 21%** (best, 5h 05m) · B 28% (6h 55m) · C 41% (7h 50m) |
| Delivery NE-102 | risk **LOW**, failure **18%**, ETA **5h 05m**, no delay, **No action required** |
| Supply Intelligence | Critical **0** · At-risk **3** · Projected stockouts **3** · Districts affected **3 of 15**. Tawang medicine **WARNING, 2.1 d** |
| AI Risk Center | 15 segments. **SEG-010 Bhalukpong – Tenga Valley sits at 43, MEDIUM** — mid-table, unremarkable |
| Incident Center | **6 open reports**, 3 high or critical |
| Analytics cascade | Incidents 6 · Segments at risk 6 (**2 not fully open**) · Deliveries affected 3 · Supply lines at risk 3 (**0 below the 48h line**) |

### The cascade

| # | Do this | Expect on screen |
|---|---------|------------------|
| 1 | Command Center → **Simulate Heavy Rainfall** | Takes a moment; it runs the whole cascade. Conditions become **Heavy Rainfall**, the hero reads **Cascade complete** and carries a `SIMULATED EVENT` tag |
| 2 | Watch the KPI strip | At-risk **3 → 4** (+33%, **2 critical**) · Road blockages **2 → 3** (1 major, 2 minor) · **Critical supply alerts 0 → 1** (1 district). Active deliveries stay **7** — no new delivery appeared, and the strip does not pretend one did |
| 3 | Route under assessment | **A 21% → 87%**, ETA 5h 05m → 7h 20m. **B becomes best at 32%.** Recommendation **USE ROUTE B, 91% confidence** |
| 4 | AI Risk Center | **SEG-010 jumps to 87 and turns `partial`**, now top of the list |
| 5 | Delivery Intelligence (NE-102) | **CRITICAL**, disruption risk **87**, delay **+2h 15m**. SHAP factors show rainfall as the dominant contributor |
| 6 | Supply Intelligence → Tawang · Medicine | **WARNING → CRITICAL**. Cover **2.1 d → 32h**, with **−19h disruption drag** attributed to NE-102's delay — below the 48-hour line |
| 7 | Incident Center | The same event traced as one chain: incident → segment → route → delivery → supply → recommendation |

The story over steps 1-7: *one weather event was re-scored by the model, which lifted the
route's risk, which raised the delivery's predicted delay, which pushed a district's medicine
below the 48-hour threshold, which produced a reroute recommendation — one click, no human in
the loop.*

### The payoff — act on the recommendation

| # | Do this | Expect on screen |
|---|---------|------------------|
| 8 | Delivery Intelligence → **Reroute delivery** | **REROUTE APPLIED.** NE-102 moves to Route B: risk **87% → 32%**, expected delay **None** |
| 9 | Supply Intelligence | Tawang medicine **CRITICAL → WARNING**, cover **32h → 2.1 d**, drag gone. **This is the point of the product** — the reroute protected the medicine, and the number moved because of it |
| 10 | Command Center | At-risk **4 → 3**, critical **2 → 1**, **critical supply alerts 1 → 0**, recommendation back to **No action required**. Road blockages stay at **3** — rerouting a truck does not repair a road, and the strip does not claim it did |
| 11 | Field Operations | The REROUTE action has left the queue; **pre-positioning remains open**, labelled as ready rather than done |

### Comparing the three routes (any time, either state)

In Route Intelligence, click a row of **Route Comparison**, a route chip on the map, or the route
line itself. The map re-frames on that route, draws it on top at full strength and fades the other
two, and every panel switches to it: risk, ETA, distance, SHAP factors, terrain profile and the
corridor segments it travels. The choice is kept in the URL (`/routes?route=…`), so reload and
links keep it. The route tiles on the Command Center and Delivery Intelligence do the same for their
maps.

| Route | Drawn through | Segments | Baseline → heavy rain |
|---|---|---|---|
| A | the corridor, Tezpur → Bhalukpong → Bomdila → Sela Pass | all 15 | 21 → **87** |
| B | Mangaldoi → Udalguri → Kalaktang → Bomdila → Sela Tunnel | 7 — **bypasses SEG-003…010**, including the storm's SEG-010 | 28 → **32** |
| C | Tezpur → Balipara → Seppa → Dirang → Jang | 9 | 41 → **64** |

Orang – Dhekiajuli is **SEG-006**, a stretch of the corridor, not a route of its own: A and C travel
it, B bypasses it. To frame it, open the **Flood** report at the Orang culvert in the Incident Center.

The lines are schematic, drawn through real towns; road-network geometry arrives with the
OpenRouteService phase.

### Reporting an incident on the map

**Report incident** (Live Map panel header, or the Incident Center hero) arms the map: the cursor
becomes a crosshair and a banner says *Click the map where the incident is · Esc to cancel*.
Click, and a blue pin marks the spot while the form opens with the coordinates filled in (they
can be edited, or re-picked with **Change on map**). Filing it drops a hazard triangle at exactly
that point, lists it at the top of the Incident Center queue, and says which corridor segment it
was matched to — or that none was within 5 km.

Use **LOW or MEDIUM** unless you mean to run the storm: a HIGH or CRITICAL report on the corridor
re-scores the segment and runs the full cascade, exactly like **Simulate Heavy Rainfall**.
Reset Demo clears every report filed during the session.

### If asked "is any of this real?"

Say what is on the screen. Every panel carries a provenance tag — `ML PREDICTION`,
`LLM EXPLANATION`, `SYNTHETIC OPERATIONAL`, `SIMULATION EVENT` — and the status rail reads
**DEMO DATA · Models: not connected**. The risk scores are seeded fixtures standing in for
XGBoost output; the decision engine and the stockout arithmetic are real and deterministic; the
reroute is a real typed action that changes state. Nothing on screen claims to be live.

---

## Sections 5-8 — legacy full-stack notes

Everything below describes the **earlier Node + FastAPI + PostgreSQL build**. None of it runs
during the frontend demo: there is no Twilio call to fail, no ML service to block, no database
to lose. It is kept because every line of it will matter again the moment Phase 4 wires a real
backend — these are failures that were actually hit and diagnosed, not hypotheticals.

**If you are presenting today, stop reading at section 4.**

---

## 5. When Twilio does not send

It will not send. Both channels fail on trial-account restrictions
(`Trial accounts can only use predefined SMS templates` / `Invalid or disallowed parameters`).
The alert is still created, `notifiedViaTwilio` is `false`, and the UI correctly does **not**
render a "Notified via Twilio" tag.

Say this:

> "The Twilio account is on a trial tier, so the SMS and voice call are rejected at the provider.
> Notice what the system does with that: the alert is still created, the risk, delay and stock
> numbers are all still updated, and the interface reports the notification as not sent rather
> than claiming success. A downstream provider failing is not allowed to fail the decision
> pipeline — that is section 6.11 of our contract, and this is it working."

Do not apologise for it. A cascade that completes while honestly reporting a failed notification
is a resilience result, not a defect.

---

## 6. If you are asked why both numbers read ~100%

Step 6 of the script puts failure probability at 100% next to a PRE_POSITION confidence of ~100%,
which invites the question. Say this:

> "The 100% is the delivery-risk model's own output for a delivery whose route has just gone
> critical — it is not the recommendation's score, it is the prediction's. Section 4 of our
> contract says each decision branch reports the confidence of whichever prediction actually
> drove it, and PRE_POSITION fires because that predicted delay pushed the district's stock
> under 48 hours, so the two numbers are the same figure by design. And to be straight with you:
> these models train on synthetic data generated from a documented weighted formula, so a
> confident number is expected and is not the claim we are making — the claim is the cascade
> working end to end and being able to tell you which factors drove any individual score."

---

## 7. If something fails live

**ML service not responding** — the cascade will do nothing. Restart it (section 1) and re-run
reset. **There is no fallback if it fails live** — no backup recording exists, and every other
part of the demo still renders normally, which makes the failure easy to miss until the moment
it matters. This is why section 1's health check is not optional: verify
`http://localhost:8000/internal/health` answers before you present, every time.

Verified behaviour with the ML service down: `POST /api/ai/risk` returns a clean
`503 {"error":"Risk service unavailable"}`, every non-ML page (deliveries, districts, alerts,
analytics) still returns 200 and renders, and simulate-rain returns `500 {"error":"Internal
server error"}` — handled, with no stack trace in the response body. So the app degrades rather
than crashing; it just cannot produce the cascade.

**ORS fails** (Route Intelligence) — **VERIFIED**. `POST /api/routes/candidates` returns
`503 {"error":"Routing service unavailable"}` and fabricates nothing: the Route table was
unchanged across the failing call (7 rows before, 7 after). Route Intelligence shows
*"Routing service unavailable. No candidates were generated."* — an honest message, not a blank
map or a crash; the delivery selector and origin/destination still render. Nothing else on the
page breaks, and no other page is affected. It is not part of the core cascade story, so if ORS
is flaky on the day you can simply skip that module.

**Gemini fails** — **VERIFIED**. `/internal/predict-risk` returned HTTP 200 with the identical
`riskScore 87 / CRITICAL` and a full set of real SHAP `topFactors`, and the prose fell back to
the exact contract template: *"Risk is elevated primarily due to recent rainfall and landslide
and closure history."* Only the sentence changes — the score, the level and the factor
breakdown are unaffected, because they come from XGBoost and SHAP, not from Gemini.

**Gemini vision is the flakiest thing in the build.** During the Session H sweep only about one
incident submission in three came back classified; the other two hit the 20s vision timeout and
fell back to `NORMAL` at `0%` confidence, which means **no cascade fires from that report**. The
tell is a detected class of `normal` with a confidence of exactly `0%`. If you are demonstrating
the incident-report path and see that, just submit the same report again — it usually succeeds
within two or three attempts. Do not present the incident path as the primary cascade
demonstration; simulate-rain (section 4) does not touch vision and is reliable.

**A page shows an error box** ("… is unavailable. Retry in a moment.") — navigate to another
module and back; that re-runs the fetch. There is no in-page retry button.

---

## 8. Known and accepted

- Twilio does not send (above). §6.15's `url`/`PUBLIC_BASE_URL` fix is unimplemented.
- Incident Center is a submit form and shows no list of past incidents — the 7 seeded reports
  appear on Field Operations and the Live Map instead.
- Seeded incidents read "9d ago" because the seed is anchored to a fixed timestamp so that reset
  is deterministic.
- Route Intelligence candidate risk (~49) differs from the stored demo route (34) because they
  cover different segment sets; both are correct averages under §6.7.
- GPS anomaly alerts do not re-fire within 10 minutes even if the vehicle recovers and slows
  again. §6.12 says the cooldown should be waived in exactly that case, but §1's alert dedup
  (same relatedType + relatedId + severity within 10 minutes) is unconditional and blocks it.
  Verified in Session H; needs a contract decision between the two rules, so it was left alone.
  It has no effect on the demo — the first anomaly alert fires correctly and does not spam.
