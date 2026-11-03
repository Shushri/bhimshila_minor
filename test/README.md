# Checks

```sh
npm run dev                            # in one terminal, then:
npm test                               # every suite, honestly skipping what needs a server it can't find
```

Or one at a time:

```sh
node test/testall.mjs                  # 54 API checks, every route
node test/authz.mjs                    # 11 authorization checks on the write paths
node test/triage.mjs                   # 19 SOS triage cases, no server needed
node test/router.mjs                   # 47 intent-routing cases, args included
node test/sachet.mjs                   # 33 checks against the live NDMA feed
node test/watch.mjs                    # 14 monitoring-loop checks
node test/districts.mjs                # 42 census/projection checks, no server needed
node test/exposure.mjs                 # 17 population-at-risk checks, live feed
node test/protocols.mjs                # 37 precaution/protocol checks, no server needed
node test/shelters.mjs                 # 12 offline shelter checks, no network at all
node test/language.mjs                 # 19 reply-language checks, no server needed
node test/telegram.mjs                 # 13 Telegram-linking checks
node test/missions.mjs                 # 30 org, membership and deployment-log checks
node test/field.mjs                    # 40 chat, report, broadcast-gate and drill-down checks
node test/anomaly.mjs                  # 14 checks on the 80-year rainfall statistics, live archive
```

Everything is rerunnable against a database that already has history. Nothing
here asserts on an absolute row count.

`_build.mjs` transpiles modules straight out of `src/` with esbuild rather than
copying them, so no check can quietly drift from the code that ships — the
failure mode where a suite keeps passing against a stale copy of the logic is
the one worth designing out.

## What each one is really protecting

**`triage.mjs`** covers the decision about who gets rescued first. Half its
cases are the keyword parser, which is what runs when no model is reachable —
exactly the conditions under which real emergencies arrive. The other half pin
something subtler: the model is not allowed to talk the system down. Asked to
structure *"paani ghar me ghus gaya, chhat pe phase hain"*, a live model
answered `shelter` — people trapped on a roof by rising water, filed as a
request for accommodation. Category and severity are resolved deterministically
for that reason, and these cases hold that line.

**`router.mjs`** — the three `→ model` cases matter as much as the matches.
Routing an ambiguous question is worse than deferring it, because a wrongly
chosen tool answers confidently. The alert cases are the sharp edge: "send an
alert" and "is there an alert" share nearly every keyword, and confusing them
stages a broadcast when the user asked a question.

`router.mjs` asserts arguments, not just the tool name. A case that checks only
the name passes while the tool gets nonsense: "Madhya Pradesh ke Indore district"
routed to the right tool with a place called "ke Indore", because a
case-insensitive flag let `[A-Z]` match the Hindi particle.

**`sachet.mjs`** talks to the live NDMA feed on purpose. Its parsing risks fail
silently rather than loudly — the feed writes centroids longitude-first, so a
swap plots every Indian alert in the Arabian Sea, and it stamps dates `IST`,
which `Date.parse` mishandles. A fixture would freeze today's shape and stop
testing the thing that actually breaks. If NDMA is unreachable these fail
loudly, which is correct: the source is down and the app should be saying so.

**`testall.mjs`**'s alert-provenance block asserts an invariant rather than
today's weather, because which regions have a live official alert changes hour
to hour. Every staged alert must say where its wording came from, and our own
drafted line must never appear while an authority's CAP identifier is cited as
the basis.

**`watch.mjs`** guards two failure modes of the monitoring loop. Crying wolf:
without a record of what was already known, every sweep reports a hundred
brand-new alerts and the queue stops being read — so a repeat sweep must report
nothing. And the worse one: an unreachable feed reported as "no alerts", which
turns a government outage into an all-clear.

**`districts.mjs`** guards the census layer under everything else. That data
went through alias tables, fuzzy matching and an apportionment step, and each
can be wrong in a way that still sums correctly — so the per-district spot
checks matter more than the totals. A substring match once handed Delhi New
Delhi's 142,004 people instead of the NCT's 16.8 million; a scaling pass once
inflated Thane by 783,000 to balance an unclaimed Mumbai. Both are pinned now.

**`exposure.mjs`** covers how many people are under each official alert — what
turns ~70 flat warnings into a queue. The failure it guards is a confident
wrong number: double-counting a district that sits under three alerts, matching
a bare "Bilaspur" to the wrong state, or letting a geometric estimate pass as
though the issuer had named the districts. It also pins the ordering, because
sorting purely by headcount once floated a yellow "be aware" thunderstorm over
97 million people above every red alert in the country.

**`language.mjs`** covers which voice answers. There used to be a Hindi/English
switch in the header; a single Indian sentence runs "Kerala mein red alert hai,
kitne log affected hain" and flipping a mode mid-thought is what makes a voice
UI feel like a machine. The failure it guards is asymmetric — the Hindi voice
reads Hinglish acceptably, the English voice reads Devanagari as silence — and
it caught a real one: the script check covered only Devanagari, so NDMA's own
Malayalam alert text would have been read aloud as a pause.

**`missions.mjs`** covers the deployment log — the organizers' Track B
deliverable, and the half that made three roles mean anything. Its sharpest
cases are the boundaries: a volunteer in one NGO changing an id to reach
another's mission, and the offline replay, where the same transition
legitimately arrives twice and must neither error nor drag the task backwards.

It also gets its own site per run. Incidents cluster by category, 12km and 12
hours, so a second run merged into the first run's incident — already dispatched
to that run's organisation — and every later check reported "belongs to another
organisation". The boundary was working; the fixture was reusing the world.

**`authz.mjs`** covers who may move a team or broadcast to a region. Raising an
SOS stays open to everyone — a person in danger must never hit a login wall —
but acting on one is a coordinator's job.

**`field.mjs`** covers the layer that lives inside a mission: the chat thread,
ground reports with photos, and the broadcast gate. Its sharpest checks are the
two the trust model turns on — raising a broadcast request must send *nothing*
(the alert count is asserted unchanged), and the staging preview must name the
exact team the confirm will dispatch, because a confirm gate that shows one
team and sends another is theatre. The media checks pin the boundary too: a
photo comes back only through the mission API, an outsider's read is a 403,
and an oversize or non-image upload is refused with a reason.

**`anomaly.mjs`** covers the 80-year rainfall comparison, live against the
ERA5 archive for the same reason sachet.mjs runs live. The check worth having
is rank-vs-percentile agreement: both come from one sorted list, so if they
ever disagree the sort or the comparison has inverted — a silent failure that
would swap "wettest fortnight since 1988" with "perfectly ordinary", in either
direction. The desert case (Jaisalmer) holds the other end: code tuned on
monsoon hills must not cry wolf where the median fortnight is near zero.
