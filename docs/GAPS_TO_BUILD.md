# Gaps → features → tools

Derived from `NEED_AND_GAP.md`. Every row traces to a source, so nothing here
is built on a hunch. Ordered by evidence strength × buildability.

## The seven gaps the research exposed

| # | Gap | Evidence | Already covered? |
|---|---|---|---|
| 1 | Alerts reach only registered users; the relay mechanism that actually works is a person telling a person | J-PAL Bihar RCT: volunteer relay → **+46.5%** alerts arriving before the water; 1 in 5 had a smartphone | ❌ No relay concept at all |
| 2 | No shared picture of relief camps and what each one needs | Kerala 2018: students hand-built a camp database to direct supply trucks | ❌ No camp entity |
| 3 | Duplicated effort — two responders to one place, none to another | Aceh: 4× measles vaccinations. Haiti: "some areas duplicated, others no access" | 🟡 Half — coverage *gaps* exist, *overlap* does not |
| 4 | Warning issued, nothing done, nobody notices until it's too late | Wayanad 2024: risk zones known since 2020, "failed to organize timely evacuations" | 🟡 Queue exists, no ageing/escalation |
| 5 | Inter-agency coordination | Cluster system exists precisely because agencies don't share | ❌ Single-tenant per org |
| 6 | Citizens expect WhatsApp/SMS, not a new app | Mongabay: 26 apps averaged 1,119 downloads; named "no integration with WhatsApp, SMS" | 🟡 Telegram shipped; WhatsApp needs Meta verification |
| 7 | Needs assessments obsolete before they're published | Haiti: $3M assessment "obsolete and no longer reliable" on release | ✅ Live data, not a survey |

## What this build closes

**Gap 1 and Gap 2 — built now.** Both are concrete, both trace to the two
strongest cases in the research, and both are missing entirely rather than
partially.

**Gap 3 — built now**, because it is pure computation over data already held
and it completes a feature that currently only tells half its story.

**Gap 4** — deferred. The watch queue already surfaces unacknowledged alerts;
adding ageing is a refinement, not a missing capability.

**Gap 5** — not attempted. Cross-tenant coordination is an architecture
change, not a feature, and this is days from a demo.

**Gap 6** — blocked externally. WhatsApp Cloud API needs Meta Business
verification. Code path exists; the credential does not.

---

## Feature 1 · Community relay

*Closes gap 1. J-PAL measured this exact mechanism.*

A volunteer who receives an alert can record that they passed it on — to a
village, a WhatsApp group, a door-knock round — and how many households it
reached. That turns an alert's reach from "registered users we pushed to"
into "registered users **plus** the people a human being actually told",
which is the number that mattered in the Bihar trial.

**Schema** — `relays (id, alert_id, user_id, households, place, method, note, created_at)`

**Tool** — `alert_reach(alert_id?)` · read-only · returns registered
delivery count, relayed household count, and the multiplier between them.

**Why read-only:** logging a relay is a UI action by the person who did it,
not something an agent should do on their behalf. The agent reports reach;
it does not claim someone relayed something.

## Feature 2 · Relief camps and unmet needs

*Closes gap 2. This is the artifact Kerala's students built by hand.*

Camps have a population and a list of needs. Teams already carry resources
(boats, medical kits, food packets). The match between them is the supply
run that a truck should make next, ranked by how many people are waiting on
it.

**Schema** —
`relief_camps (id, name, place, lat, lng, people, team_id, status, created_at)`
`camp_needs (id, camp_id, item, needed, received, urgency, updated_at)`

**Tool** — `camp_needs(place?)` · read-only · camps ranked by unmet need
weighted by population, with the nearest team holding that resource named.

## Feature 3 · Duplicate coverage

*Closes gap 3. Aceh and Haiti, in one number.*

The ops console already answers "where is nobody". It cannot answer "where
are two people doing the same thing" — which is the other half of the same
failure, and the half that wastes the scarce resource.

**Tool** — folded into the existing coverage view rather than a new tool:
two or more active assignments within 15 km of each other are surfaced as a
possible duplicate, with both team names.

---

## Build order and status

1. Schema for all three, one migration ☑ `relays`, `relief_camps`, `camp_needs`
2. Pure logic ☑ `lib/reach.ts`, `lib/camps.ts` — no database, no network
3. API routes ☑ `POST/GET /api/relay`, `GET/POST /api/camps`
4. Tool definitions + dispatch ☑ `alert_reach`, `camp_needs`, `duplicate_coverage`
5. Test suites ☑ 71 checks — `reach.mjs` 25, `camps.mjs` 25, `relief.mjs` 21
6. UI surfaces ☐ — the one thing still outstanding

### Two things worth recording from the build

**A false all-clear, found in testing.** Asked "which camps across India need
supplies", the agent passes `place="India"`. No camp is recorded in a place
called India — they are in Dhubri and Barpeta — so the filter returned empty,
and that surfaced as *"no camp needs anything"*. A filter miss reported as
good news. A place that matches nothing now widens to every open camp and says
which word it could not find, because "nothing matched that" and "nothing is
needed" must never arrive as the same sentence.

**The write path is the feature.** `alert_reach` was built first and would
have reported zero relays forever, because nothing could create one — which
looks like "nobody relays anything" rather than "nobody can record it". The
route came before any of it counted as done.

### Deliberate access decisions

| Action | Who | Why |
|---|---|---|
| Log a relay | any signed-in user | The Bihar trial measured *community members* relaying to each other. Restricting it to volunteers would encode an org chart the evidence does not describe. |
| Read camp needs | any signed-in user | A volunteer driving to a camp should know what it is short of. |
| Open a camp / set a need | coordinator only | A camp's recorded population is what ranks it against every other camp — an unreviewed edit silently reorders the supply queue. |
| Record a relay via the agent | nobody | An agent must never record that somebody warned their village. Only the person who did it can say that happened. |
