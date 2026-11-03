# System design — roles, organisations, deployment

Written 5 Aug 2026, before building. The board is done; this is the half that
is missing, and it is a stated deliverable rather than an addition.

---

## What is actually missing today

Three roles exist in the schema — `citizen`, `volunteer`, `coordinator` — and
only one of them means anything. `coordinator` gates `/api/ops` and `/api/watch`.
A volunteer can do nothing a citizen cannot.

`teams` holds 24 seeded rows with a name, a location and a capacity. Nobody is
inside them. `assignments` links an incident to a *team*, never to a *person*.
So the system can say "NDRF 9th Battalion is deployed" and cannot say who went,
whether they arrived, or what they found.

That last sentence is the organizers' Track B deliverable, quoted:

> **Deployment log** — who is deployed, where, when
> **Offline-capable sync** — works without connectivity, syncs when it returns

---

## The three actors

| | Citizen | Volunteer | Coordinator |
|---|---|---|---|
| **Who** | someone in the affected area | NGO field staff | DDMA / SDMA desk |
| **Device** | bad phone, patchy network | phone, often offline, one hand free | desktop, control room |
| **Sees** | alerts for their area, nearest shelter | only the tasks that are theirs | everything |
| **Does** | raises SOS | accepts, arrives, reports, closes | registers orgs, adds members, dispatches, broadcasts |
| **Never** | — | broadcasts to the public | — |

The volunteer screen is the one that has to survive a crisis. It should be a
list of large buttons and nothing else.

---

## Entities

`teams` already carries name, kind, place, lat/lng, capacity and status, and
everything dispatches through it. It becomes the organisation rather than being
duplicated by one.

```
teams            + created_by      who registered it
                 + verified        a coordinator vouched for it
                 + invite_code     one code per org, rotatable

memberships        team_id, user_id, role_in_org ('lead' | 'member'), joined_at
                   a person can belong to more than one org

tasks              id, incident_id, team_id, assignee_user_id,
                   status ('assigned'|'accepted'|'on_site'|'done'|'declined'),
                   note, outcome, timestamps per transition
```

`assignments` (incident → team) stays as the dispatch record. `tasks` is the
person-level layer under it — one dispatch can produce several tasks.

**Why membership is separate from `users.role`.** A person's role in the system
(what screens they get) is not the same as their role inside an organisation
(whether they can add members). A volunteer can be the lead of one NGO and an
ordinary member of another.

---

## Flows

### 1 · Coordinator registers an NGO
Name, kind, base location, contact. Creates a `teams` row with `created_by` and
`verified = 1`. It immediately becomes dispatchable — the same
`nearestTeams()` the board already uses.

### 2 · Coordinator adds members
Generates an invite code for the org. The same handshake as the Telegram link
already in the codebase: mint a code, share the link, the person opens it and is
bound on signup or login. Reuse `telegram_links`' shape rather than inventing a
second one.

### 3 · Coordinator dispatches
Existing flow: incident → nearest team → confirm. **New:** on confirm, a `task`
is created for the org. Unassigned within the org by default.

### 4 · Volunteer picks it up
Sees the task on their screen. Three buttons, in order:

```
Accept          →  accepted    (their name is now on it)
I'm on site     →  on_site
Done            →  done + a one-line outcome
```

Each transition is timestamped. That list of transitions **is** the deployment
log — who, where, when — with no separate reporting form to fill.

### 5 · Offline
The three buttons queue locally exactly as SOS already does
(`lib/offlineQueue.ts`), and sync when the network returns. A volunteer in a
flood must never see a spinner.

---

## Permissions

| Action | citizen | volunteer | coordinator |
|---|---|---|---|
| Raise SOS | ✅ | ✅ | ✅ |
| See own alerts | ✅ | ✅ | ✅ |
| See the full board | — | ✅ read-only | ✅ |
| See tasks assigned to their org | — | ✅ | ✅ |
| Accept / update a task | — | ✅ own org only | ✅ |
| Register an organisation | — | — | ✅ |
| Add members | — | ✅ if org lead | ✅ |
| Dispatch a team | — | — | ✅ |
| Broadcast an alert | — | — | ✅ |

Raising an SOS stays open to everyone including anonymous users — a person in
danger must never hit a login wall. Everything that reaches the public stays
with the coordinator.

---

## Screens

**Coordinator** — the existing board, plus one tab:
`Organisations` — register, member list, who is deployed right now, invite link.

**Volunteer** — a new, deliberately sparse page:
`My tasks` — assigned tasks with the three buttons. Below it, read-only board.

**Citizen** — unchanged: alerts inbox, SOS button, nearest shelter.

---

## Scope, honestly

It is 5 Aug. Submission is 10 Aug, and deploy, README and the video are still
outstanding. Ordered by value per hour:

| | Item | Effort | Why |
|---|---|---|---|
| 1 | `memberships` + `tasks` schema, task API | ~3h | nothing else works without it |
| 2 | Volunteer task screen with the three buttons | ~3h | **this is Track B** — the deliverable |
| 3 | Coordinator org registration + invite | ~3h | makes the org real rather than seeded |
| 4 | Offline queue on the task buttons | ~1h | reuses what exists; stated hard constraint |
| 5 | Role-aware routing (each role lands on its own screen) | ~1h | otherwise everyone sees the coordinator board |

**1, 2 and 5 are the minimum that makes the roles mean anything.** 3 and 4 are
what make it a product rather than a demo.

What this design deliberately does not add: org-to-org messaging, shift
rostering, volunteer skills matching, resource requisition. All reasonable, none
of them the deliverable, and each one is a day.
