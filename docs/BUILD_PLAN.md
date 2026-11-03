# BhimShila — Build Plan

**Window:** 3 Aug → 10 Aug 2026 · **Target submit: 9 Aug** (they reward early; leaves a buffer day)

Daily, without exception: **commit, deploy, post one Discord update.** Three of the six selection criteria — Consistency, Helpfulness, Workflow — are earned there, not in the editor.

---

## Scope discipline

Seven lifecycle stages are the *narrative*. They are not seven equal builds.

```
DEEP  ── voice command layer · verification · coordination
THIN  ── ingest · alert dispatch · deployment tracking
LATER ── recovery reporting  (README → What's next)
```

One district (Kangra). One hazard (flash flood / cloudburst). Three roles (citizen, volunteer, coordinator).

---

## Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js App Router → **Vercel** | Named in their criteria |
| Auth | Supabase Auth, phone OTP, 3 roles | Real auth ✅, right for this user |
| DB | Supabase Postgres + PostGIS | Real backend ✅ + geo |
| Offline | IndexedDB queue + sync on reconnect | Stated requirement in the brief |
| Weather | **Open-Meteo** forecast + historical | Free, no key, 1.5 km, 80y history |
| Streams | OSM Overpass API | Free waterway geometry |
| AI | **Claude API** — voice intent, verification, clustering | They award Claude Pro; signal is obvious |
| Voice | STT + TTS, Hindi first (Sarvam / ElevenLabs) | The spine of the product |
| Dispatch | WhatsApp Cloud API (SMS fallback) | Covers "nice extras" |
| Maps | Leaflet + OSM tiles | No paid key |

---

## Day by day

### D1 · Mon 3 Aug — Live on day one
- Public repo, MIT licence, README stub
- Next.js scaffold; Supabase phone OTP; three roles (citizen / volunteer / coordinator)
- **Deploy to Vercel today.** An ugly live URL beats a pretty local one
- Discord: intro + what you're building

### D2 · Tue 4 Aug — Intake spine
- Schema: `users`, `clusters`, `reports`, `incidents`, `alerts`, `deployments`, `resources`
- **Voice SOS** (citizen) and **voice needs-report** (volunteer): record → STT → Claude structures it into fields
- **Offline queue** — reports written locally, synced on reconnect. Build it now, not later; retrofitting offline is painful
- Seed Kangra reference points incl. Khaniyara / Manuni

### D3 · Wed 5 Aug — Clustering & prioritisation
- Claude merges overlapping reports into single incidents; kills duplicates
- Severity ranking **against coverage already on the ground** — this is what fixes "aid duplicates here, absent there"
- Coordinator dashboard v1: live incident list, map, filters

### D4 · Thu 6 Aug — Voice command layer *(the differentiator)*
- Intent parsing: *"Khaniyara ko alert bhejo"*, *"nazdeeki team bhejo"*, *"kitne SOS pending hain"*
- **Confirm-before-execute**: the assistant states the action and its target, then acts. Never fire an alert on an unconfirmed parse
- Command palette with voice + typed fallback

### D5 · Fri 7 Aug — Ingest, verify, alert
- Open-Meteo client: forecast intensity + 72h antecedent rainfall; elevation/slope; stream distance
- **Deterministic risk scorer** in plain TypeScript, explicit weights, returns score **plus contributing factors**
- **Verification layer**: signal cross-checked against reports/SOS density and volunteer confirmations → confidence score; low confidence holds the alert
- Alert dispatch over WhatsApp, targeted to exposed clusters, in Hindi, **reason always attached**

### D6 · Sat 8 Aug — Deployment, resources, polish
- Deployment tracker: who is active where, shift status
- Resource levels per team; assignment flow from an incident
- Mobile-first pass — big targets, large type, one-handed
- Empty / loading / error states; alert dedupe + cooldown
- **Replay mode**: 25–26 June 2025 Khaniyara on real historical data

### D7 · Sun 9 Aug — Ship
- README: problem, users, stack, live URL, screenshots, **"What this is not"**
- Screencast **of how you built it** — a stated criterion, not a product tour
- Full pass on a real phone: SOS → cluster → priority → assign → alert → replay
- **Submit**, then post the link in Discord and ask for feedback

### Mon 10 Aug — Buffer
Deadline day. Fix what feedback surfaces. Start nothing new.

---

## Cut list

Drop from the bottom up. Never cut above the line.

```
KEEP ───────────────────────────────────────────
  auth (3 roles) · voice SOS/report · clustering
  prioritisation · coordinator dashboard
  voice commands · deployed · public repo
──────────────────────────────────────────  LINE
  verification confidence scoring
  replay mode
  WhatsApp dispatch
  deployment tracker + resources
  offline sync
  languages beyond Hindi
```

If the week collapses, a **voice-operated coordination platform** is still a complete, coherent product. That is the floor — and it alone satisfies both tracks of the brief we were sent.

---

## Demo script — 2 minutes

1. *"This is Khaniyara, Dharamshala. We're standing in this valley."*
2. *"26 June 2025 — the Manuni flash-flooded. Labourers in temporary sheds swept away. Two dead, six missing. A red alert was already out — for Kangra district, 5,700 km² of it."*
3. **Replay, 25 June 18:00, real historical data.** Risk climbs.
4. **Verification fires** — two ground reports corroborate the signal, confidence crosses threshold. *"We don't broadcast on a machine signal alone. This is what protects the alert from being ignored next time."*
5. **Targeted Hindi voice alert** goes to the mapped shed cluster, reason attached.
6. **Switch to aftermath.** Voice SOS arrives. Duplicates merge. Priority list reorders. Coordinator says *"nazdeeki team bhejo"* — assignment made, hands-free.
7. *"We don't forecast weather and we don't replace SACHET. We're everything between a signal arriving and a person being reached."*

---

## Standing risks

| Risk | Mitigation |
|---|---|
| "SACHET already exists" | Answer before they ask — README and demo closing line |
| Sounding like we claim to predict disasters | Never say predict. Say *ingest, verify, translate*. Cite IMD/CWC as authority |
| Seven shallow modules | Enforce the depth/thin split above. Depth in voice, verify, coordinate |
| Voice fails live | Typed fallback always visible; cache replay responses; record fallback video on D7 |
| Offline retrofitted too late | Built on D2, not bolted on at the end |
| Scope creep to multi-hazard / national | One district, one hazard. Everything else → README "What's next" |
