# Brief 14 — Disaster Response & Resilience · Deliverables

Extracted from the brief as sent. Two tracks.

---

## Track A — DELIVERY (relief coordination)

**Problem:** After a disaster, relief is chaotic — duplicated aid in some areas, none in others, no shared picture of need.

**Build:** A tool that consolidates real-time needs reports from affected areas into a shared, prioritised view for relief coordinators.

### Deliverables
1. **Needs-reporting form** — lightweight; field volunteers submit what is needed, where
2. **Prioritisation / clustering model** — consolidates incoming reports, dedupes overlapping ones, ranks by priority
3. **Shared coordination dashboard** — one live view of need across areas, for relief coordinators

### Hard constraint (their design question)
> *"In a crisis, how do you keep data entry simple enough for stressed, resource-constrained field volunteers to actually use under pressure?"*

Entry must survive a stressed user. This is a stated requirement, not a nice-to-have.

---

## Track B — CAPABILITY (internal ops)

**Problem:** Response NGOs struggle to track volunteer and staff deployment across shifting situations → burnout or coverage gaps.

**Build:** A simple internal deployment tracker showing who is active where during a response.

### Deliverables
4. **Deployment log** — lightweight; who is deployed, where, when
5. **Offline-capable sync** — works without connectivity, syncs when it returns

### Hard constraint (their design question)
> *"How do you keep this usable when connectivity and time are both scarce during an actual disaster?"*

Offline-first is a stated requirement.

---

## Summary

| # | Deliverable | Track |
|---|---|---|
| 1 | Needs-reporting form | Delivery |
| 2 | Prioritisation / clustering model | Delivery |
| 3 | Shared coordination dashboard | Delivery |
| 4 | Deployment log | Capability |
| 5 | Offline-capable sync | Capability |

**Two constraints that apply across all five:** usable by stressed field volunteers under pressure, and usable when connectivity is scarce.
