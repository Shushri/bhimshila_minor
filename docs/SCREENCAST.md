# BhimShila — the screencast

Everything below is checked against the running build on 10 Aug 2026. Numbers
that move (alert counts, districts elevated) are marked **read-from-screen** —
say what you see, never what you memorised.

**Timing.** 2,839 spoken words. At the 150 words a minute most people narrate a
screencast at, the full film runs **20:00**.

Everything you asked to include does not fit in fifteen minutes, and I would
rather tell you that than quietly drop half of it. So there are two versions of
this script and they use the same recording session:

- **The full cut — 20:00.** Every scene below as written. Use this if the
  submission has no hard length limit; it is the one that actually answers all
  four questions properly.
- **The 15-minute cut — 15:15.** Exact instructions at the bottom, under
  *The 15-minute cut*. It is surgical: named paragraphs, nothing improvised.

Decide which one you are recording **before** you start, not halfway through.

The film answers four questions, in the order a stranger asks them:

| Angle | The question | Scenes |
|---|---|---|
| **Impact** | Who is this for, and what changes for them? | 1–2, then 10 |
| **The data** | Where does the truth come from, and how did you get it in? | 3–4 |
| **The real project** | Is this actually built, end to end? | 5–7 |
| **The AI workflow** | How does it work, how did you build it, how do you know it's right? | 8–9 |

Impact opens and closes. Everything between is proof.

---

## Before you hit record

**1. Make the agent fast.** The chain currently leads with OpenRouter's free
550B model: **7.1s** a turn. Groq answers the same question in **1.4s**. On
camera that difference is the whole demo. In `src/lib/agent/llm.ts`, move the
Groq block above the OpenRouter block in `PROVIDERS` — OpenRouter stays
underneath as the fallback, so nothing is lost.

Press the handover button *before* you start talking over it — with the model
writing prose it takes about 45 seconds, and that is a long silence.

**2. Tabs open, in this order:**

| Tab | What |
|---|---|
| 1 | `localhost:3000` — **coordinator** `9100000011` / `bhim2026` |
| 2 | Second browser profile — **citizen** `9100000013` |
| 3 | Third — **volunteer** `9100000012` |
| 4 | VS Code, `src/lib/agent/router.ts` open |
| 5 | Terminal, cleared, in the repo |
| 6 | GitHub → the repo's Actions tab |
| 7 | `sachet.ndma.gov.in` — the government portal itself |

**3. Ready to paste** so you never type on camera:

```
Assam mein abhi kya alerts hain
Kerala kholo
paani ghar me ghus gaya, chhat pe do log phase hain
```

**4. Run `npm test` before recording** so the terminal holds a warm result you
can scroll back to. Fifteen suites take minutes; you don't want that on tape.

**5. One take per scene, not per film.** Eleven clips stitched is
indistinguishable from one long take, and infinitely easier to fix.

---

## The shape of it

| # | Scene | Runs | Ends |
|---|---|---|---|
| 1 | The boulder | 1:00 | 1:00 |
| 2 | Three people | 1:25 | 2:25 |
| 3 | Where the truth comes from | 1:20 | 3:45 |
| 4 | How the data got in | 2:30 | 6:15 |
| 5 | The coordinator | 1:25 | 7:40 |
| 6 | The citizen | 1:25 | 9:05 |
| 7 | The volunteer | 1:15 | 10:20 |
| 8 | How the AI actually works | 3:50 | 14:10 |
| 9 | How I built it, and where it went wrong | 3:20 | 17:30 |
| 10 | What changes | 1:35 | 19:05 |
| 11 | What this is not | 0:55 | 20:00 |

---

# Scene 1 · The boulder — 1:00

**ON SCREEN** — Open on the app already running, Overview tab, the India map
glowing. Don't move the mouse. Let it sit.

**SAY**

> On the sixteenth of June, 2013, a flood came down the Mandakini valley and
> took most of Kedarnath with it. The temple survived because a boulder had
> come to rest just behind it, and split the water into two streams that went
> around the building instead of through it. People call that rock Bhim Shila.
>
> It didn't save anyone by being clever. It saved people by being in the right
> place, before the water arrived.
>
> That's the idea behind this product, and why it has that name. India doesn't
> lack warnings — the IMD, the Central Water Commission and every state
> authority publish them all day. What's missing is the thing standing between
> the warning and the person, early enough to matter.

**NOTE** — Show nothing here. These forty-five seconds buy you the next
sixteen minutes.

---

# Scene 2 · Three people — 1:25

**ON SCREEN** — Three cuts, ~15 seconds each, no clicking:
1. Coordinator → Operations, incident board.
2. Citizen → Overview, the three quick-action buttons.
3. Volunteer → `/missions`, mission cards.

Return to the coordinator.

**SAY**

> Three people use this, and they need completely different things.
>
> The district coordinator has forty alerts on her desk and eight teams. She
> doesn't need more alerts. She needs to know which of the forty has people
> under it and nobody near it.
>
> The citizen is standing in water right now. He can't fill a form, he can't
> spell his district in English, and he can speak maybe one sentence into a
> phone before the network drops.
>
> The volunteer is in the field at eleven percent battery, and needs most not to
> be told what he already knows.
>
> One dashboard for all three would fail all three. So there are three logins,
> and each opens onto a different product.
>
> Where AI comes in is specific, and I want to be precise, because "AI-powered
> disaster app" is a phrase that should make you suspicious. The model here does
> not decide who is in danger. It reads and writes language. Everything that
> ranks a human being — how urgent, how many, who goes first — is arithmetic I
> wrote, that you can read.

---

# Scene 3 · Where the truth comes from — 1:20

**ON SCREEN** — Overview. Slowly: KPI tiles → hover a glowing state → scroll
the unified feed so official rows and citizen incidents sit together → point at
one official row's evidence lines.

**SAY**

> Start with the data, because everything is downstream of it.
>
> The spine is Sachet — NDMA's official alert feed. When a state authority issues
> a flood warning, or the Central Water Commission flags a river gauge, it lands
> here. **read-from-screen: about sixty live alerts.**
>
> That's what has been *issued*. Underneath it, I run my own reading — every
> district centre in India scored on what's already fallen, what's coming, how
> hard, how close the nearest river is, how low the ground sits.
> **read-from-screen: 724 districts.**
>
> Then corroboration, because a weather model alone cannot
> tell you whether anything actually happened. Six news feeds, including Hindi.
> USGS for earthquakes. GloFAS river discharge. OpenStreetMap for water and
> shelters. Census, for how many people are underneath.
>
> And look at what an official row says about itself — who issued it, until
> when, how many people, and whether my own scan agrees. Where my signal is
> quiet and an authority has warned, the authority is right. They have radar and
> river gauges. I don't.

---

# Scene 4 · How the data got in — 2:30

The integration scene. Screen moves off the app.

**ON SCREEN**
1. Tab 7 — `sachet.ndma.gov.in`, the actual government portal.
2. Cut to `src/lib/kb/sachet.ts` — scroll to the longitude-first comment and the
   `actionable()` gate.
3. Cut to `scripts/build-district-profiles.mjs` — stop on the checksum line.
4. Cut to `src/lib/kb/national.ts` — the four-calls comment.

**SAY**

> None of this arrived as a tidy API.
>
> This is Sachet, the government portal. No subscription, no webhook — the
> Common Alerting Protocol over HTTP is poll-based, so "subscribe to NDMA" means
> poll politely. An RSS index of what's live, and a documented endpoint for the
> full CAP document behind any one alert. Their guide makes caching mandatory —
> send back the ETag you were given, honour the 304 — which matters when the host
> takes nineteen seconds to answer on a bad day.
>
> Two traps in that feed, and both fail silently. The coordinates are written
> longitude first, and read the other way round every alert in India lands in the
> Arabian Sea. The timestamps are stamped IST, so read as UTC a three-hour
> warning looks expired. Then two gates: only status Actual gets through, so a
> drill can never go out as real, and a cancelled alert stops showing as live.
>
> Census was a different kind of work. 2011 district tables, a hundred and
> eighteen columns — and the obvious ones are the wrong ones. Literacy tells you
> very little about surviving a flood. I kept what changes a responder's
> decision: fragile housing, whether a household has any phone at all, how rural,
> how elderly, how poor.
>
> And this line is the one I'd point at. Every build re-checks that the district
> populations sum to exactly one-two-one-zero-eight-five-four-nine-seven-seven —
> the published national total. A mirror that's been quietly edited fails
> immediately.
>
> 2011 is fifteen years old and still the most recent completed census; 2021 was
> postponed to 2027. So rather than invent a growth rate, I carry each state
> forward to 2026 using the National Commission on Population's own projections.
> Their estimate, not mine, labelled a projection everywhere it appears.
>
> Open-Meteo needs no key and no signup, and takes about two
> hundred coordinates in a single request — so the entire country is four calls,
> cached fifteen minutes. That is the only reason continuous national monitoring
> is affordable at zero rupees.

---

# Scene 5 · The coordinator — 1:25

**ON SCREEN**
1. Say or type **"Kerala kholo"** → the state deck opens. Let the windows land.
2. Scroll it: alerts, risk, forecast, 86-year anomaly, river discharge, news,
   population, deployments.
3. Feed → **Alert** on an orange row → staging shows the recipient count and the
   issuer's own wording → point at Confirm, **don't send**.
4. **Dispatch** on a citizen incident → nearest team named and pinned → confirm
   this one.
5. Operations → the deployment is in the log.

**SAY**

> This is a control room, not a feed reader.
>
> Kerala — everything about that state in one place. What's been issued, what my
> scan says, the forecast, and this one I'm proud of: how this fortnight's
> rainfall ranks against every same fortnight since 1940. Plain arithmetic, no
> model. When a coordinator asks "is this actually unusual", that is the only
> honest way to answer.
>
> Now watch what happens when she wants to warn people. It stages first. It
> tells her exactly how many registered people this reaches, and it shows her
> the wording — which is the issuing authority's own wording, in the language
> they published it in. I don't machine-translate a government warning. Nothing
> leaves until she presses confirm.
>
> Same for a rescue. This is a real citizen SOS. It picks the nearest team, pins
> it, and asks. A human is in the loop on every outward action in this product.
> The AI proposes. It never sends.
>
> And it lands in the log — because coordination isn't only deciding, it's being
> able to show afterwards what was decided, and when.

---

# Scene 6 · The citizen — 1:25

**ON SCREEN** — Citizen tab.
1. Tap the orb: *"paani ghar me ghus gaya, chhat pe do log phase hain."*
2. Show the structured SOS — category, severity, headcount, place.
3. Cut to the coordinator's board; it's there.
4. Back on citizen: tap **⌂ Nearest shelter**.
5. Show the inbox and the Telegram link.

**SAY**

> The citizen side had one rule: he can't be required to know anything.
>
> No form. One sentence, in whatever language he actually speaks — and back comes
> structure. Rescue, severity five, two people, Dhubri. That's the model doing
> what it's genuinely good at: turning a sentence into fields.
>
> But the category and the severity aren't its call. A live model, given that
> exact sentence, once answered "shelter, severity four" — people trapped on a
> roof by rising water, filed as a request for accommodation. In a priority
> queue that buries a drowning under a supply run. So keywords set a floor. The
> model can raise severity. It is not permitted to talk it down.
>
> If the network's gone, the SOS queues on the phone and sends itself the moment
> anything reconnects. Nothing is lost because a tower was busy.
>
> And for someone who doesn't know what to ask — three buttons. Where do I go,
> what do I do, what's happening near me. Alerts reach him in-app and on
> Telegram, which is free, real, and works today.

---

# Scene 7 · The volunteer — 1:15

**ON SCREEN** — Volunteer tab, `/missions`.
1. Advance a mission a state (assigned → en route).
2. Open the thread, post a line; attach a ground report with a photo.
3. Tap 🧭 — coordinates go to the phone's navigator.
4. **Request broadcast** with some wording.
5. Cut to coordinator → Operations → the request is queued → approve → cut back
   to the volunteer's notifications, where the decision has landed.

**SAY**

> The volunteer's product is a to-do list that knows where he is.
>
> His missions, and only his organisation's. One tap moves them through states,
> and every tap queues offline too — the field is where connectivity actually
> fails, so that's where the queue has to work.
>
> A thread per mission, so the conversation lives with the
> work instead of in somebody's WhatsApp. Ground reports with photos, compressed
> on the phone before they're sent.
>
> And this is the piece I like most. A volunteer is the first to know a bridge
> is out — but he can't broadcast to a district on his own authority, and he
> shouldn't be able to. So he requests it, with his wording and his evidence.
> The coordinator approves in one tap, and the exact words he wrote go out. Then
> the decision comes back to him.
>
> That's the org chart, encoded. Field knowledge flows up, authority flows down,
> and neither waits on a phone call.

---

# Scene 8 · How the AI actually works — 3:50

The scene they came for. Screen share moves to the editor.

**ON SCREEN**
1. `src/lib/agent/router.ts` — scroll the intent patterns.
2. `src/lib/agent/tools.ts` — scroll the seventeen tool names.
3. The `SYSTEM` prompt at the top of `src/app/api/agent/route.ts`.
4. `src/lib/agent/llm.ts` — the PROVIDERS array.
5. Back to the app: ask **"Assam mein abhi kya alerts hain"** and let the viewer
   watch the chip and the panel land *before* the sentence does.

**SAY**

> Here's the flow — and the surprising part is how little of it is the model.
>
> You speak. Speech-to-text is the browser's own Web Speech API: free, on-device,
> streaming, and it handles Hindi. That transcript goes first to a client-side
> matcher, three lines of patterns, that catches interface commands. "Kerala
> kholo" opens Kerala's deck with no network call at all, because sending that to
> a language model costs a round trip to learn what a regex already knows. What
> separates a command from a question is the verb — "Kerala kholo" is a command,
> "Kerala mein kya chal raha hai" is a question, and that one travels on.
>
> Next, a deterministic intent router, in code. It reads the question and picks
> the tool. This exists because of something I only learned by getting throttled:
> free tiers cap tokens per minute, not requests, and shipping fourteen hundred
> tokens of tool schemas every turn just to ask the model "which tool?" bought
> about five turns a minute. That's a dead demo. So routine decisions moved into
> code, and the model became the fallback for genuinely ambiguous ones — where it
> defers instead of guessing.
>
> Seventeen tools — official alerts, risk, situation report, replay a past
> disaster, dispatch a team, prepare an alert, drive the interface.
>
> And here's the part I want to be exact about: **the model never generates UI.**
> It picks a panel from a fixed set of ten. It fills a shape. It can't invent one.
>
> The prompt. Answer with data, not prose. Never invent a risk number — the risk
> engine owns that. Never contradict a live official alert. Two sentences,
> thirty-five words maximum, because a speech synthesiser reads this aloud. No
> markdown — asterisks get pronounced. And the last rule: you may propose a
> dispatch and propose an alert. You may never claim either one happened.
>
> Now, which model does what, because they are not interchangeable.
>
> **Groq** runs the voice turn — Llama 3.3 70B, about a second and a half. Voice
> is a latency product; seven seconds of silence and the person has given up on
> you. The fastest adequate model beats the best slow one.
>
> **OpenRouter** is the widest free catalogue — a 550-billion-parameter Nemotron
> with tool calling. Slower, so it sits underneath as the fallback.
>
> **Gemini** does two jobs: another text fallback, and the neural voice coming
> back. That matters more than it sounds. On macOS the only built-in Hindi voice
> is Lekha, and it is audibly robotic — nobody in an emergency is listening to
> that.
>
> **Cerebras** is the fourth. A rate limit, a rejected key, a retired model or a
> dead host all fail down that chain — mid-build, Gemini retired a pinned model
> and every turn started 404ing. Nothing is pinned any more.
>
> Now watch the order things arrive in. The tool chip. The panel. *Then* the
> sentence. The panel is the answer; the model narrates what's already on screen.
> If it's rate-limited and says nothing at all, the app narrates the panel's own
> headline instead. The intelligence degrades to silent. It never degrades to
> wrong.

---

# Scene 9 · How I built it, and where it went wrong — 3:20

**ON SCREEN**
1. `docs/` in the file tree — PRD, SYSTEM_DESIGN, UI_DESIGN, DATA_AUDIT,
   FEATURES.
2. `AGENTS.md` — the whole file is four lines; show it.
3. Terminal: `git log` scrolling — read one commit body on screen.
4. `node test/run.mjs` warm result — 15 suites, 358 assertions.
5. GitHub Actions — CI green, and the Watch workflow summary.
6. The app: **↺ replay** on the rail → Khaniyara → let the line climb.

**SAY**

> This was built with Claude Code, and how I used it is the reason it holds
> together.
>
> Design first, code second. Before the features existed there was a product
> requirements doc, a system design, a UI design, a data audit and a feature
> tracker — I made the model argue the design with me until the shape was right,
> rather than letting it start typing. Almost every expensive mistake here would
> have been a cheap one caught in a document.
>
> This file is four lines long and it's the highest-leverage thing in the repo.
> Next.js 16 changed enough that a model's training data confidently writes last
> year's API — so `AGENTS.md` tells every session: this is not the Next.js you
> know, read the docs inside node_modules before you write anything.
>
> And every commit explains itself. Sixty-two commits, fifteen thousand words of
> reasoning in the bodies — not "fix bug", but what was wrong and what it cost.
> The history is the build log.
>
> Now, where the AI got it wrong — because it did, repeatedly, and that's the part
> worth watching.
>
> The place matcher resolved "Dharamshala" to Dhar, in Madhya Pradesh. Twelve
> hundred kilometres off, on the town this project is named after, because a
> loose substring match got there before the exact one did.
>
> The intent router had a case-insensitive regex meant to catch a capitalised
> place, and it matched a Hindi particle instead — so "Madhya Pradesh ke Indore"
> queried a place called "ke Indore". The tests now assert the *arguments*, not
> just which tool got picked, because a router that picks the right tool with the
> wrong argument passes a naive test and fails a person.
>
> And I said 757 districts for a week. Thirty-four of those rows
> were state centroids wearing a district's name. It's 724 now.
>
> None of those were caught by reading code. They were caught because something
> checked — fifteen suites, three hundred and fifty-eight assertions. The sources
> that talk to the outside world are tested against the real thing, live, on
> purpose: a frozen fixture keeps passing while the government changes the feed
> underneath it. The pipeline found three more the day I added it, including a
> monitoring cron that had never once run because the YAML was silently
> unparseable.
>
> And this is the honest test of the engine. The Khaniyara flash flood, June 2025,
> replayed hour by hour on real archive data through the live scorer. It crosses
> HIGH here — **twenty-one hours** before the flood. And it prints its own ceiling
> on the surface: archives keep what actually fell, not what was forecast. That's
> the best case, not a promise.

---

# Scene 10 · What changes — 1:35

**ON SCREEN** — Operations. The **alert-fatigue ledger**, then **coverage gaps**
(read one row aloud), then the **handover** you pressed earlier, now written.

**SAY**

> So what changes for the three people I started with.
>
> The coordinator gets two things she's never had. This is the alert-fatigue
> ledger — states with five or more warnings in thirty days and not one SOS behind
> any of them. That measures how fast a population is learning to ignore us, and
> nobody publishes it because it's unflattering.
>
> And this is coverage — live orange-and-above alerts with people under them and
> no team within a hundred and fifty kilometres. **read one row:** ten point
> eight million people, nearest team three hundred and twenty-eight kilometres
> away. That's not a warning. That's a hole in the response, visible before
> anyone has called for help.
>
> And the handover — twelve hours, where every number in it is a database query
> and the model only writes the prose around them. That's the whole philosophy in
> one button. The facts are computed. The language is generated. Never the other
> way round.
>
> Which is why AI is critical here rather than decorative. Not because it
> predicts floods — it doesn't, the IMD does. Because the gap between a warning
> existing and a person understanding it is a *language* gap, measured in hours.
> That is precisely what these models are extraordinary at closing.

---

# Scene 11 · What this is not — 0:55

**ON SCREEN** — The live URL in the address bar, then the GitHub repo with the
commit list scrolling.

**SAY**

> Three things this is not.
>
> It's not a forecast. It reads what the IMD and the CWC already publish, and
> translates it. They're cited on every row.
>
> It's not autonomous. Nothing reaches a human being without a coordinator
> pressing confirm.
>
> And it doesn't pretend. If NDMA's feed can't be reached it says unreachable —
> never all-clear, because those look identical on a dashboard and mean opposite
> things.
>
> It's live, it's open source, and the whole history is there — including the
> commits where I was wrong.
>
> Bhim Shila didn't predict the flood. It was in the right place, before the
> water. That's all I'm trying to build.

---

## The 15-minute cut

Same recording session, five minutes lighter. Drop exactly these and nothing
else — each one is self-contained, and the scene reads normally without it.

| Scene | Drop | Saves |
|---|---|---|
| 1 | The paragraph beginning *"It didn't save anyone by being clever"* | 0:15 |
| 2 | Compress the citizen and volunteer to one line each — keep the coordinator's in full, it sets up scene 10 | 0:20 |
| 3 | **Fold into scene 4.** Keep only the Sachet sentence and the 724-districts sentence; drop the corroboration paragraph and the closing evidence-line paragraph | 0:45 |
| 4 | The RSS-versus-document sentence, the census column list, and the Open-Meteo paragraph. **Keep the two traps and the checksum** — they are the best thirty seconds in the film | 0:45 |
| 6 | The quick-actions paragraph | 0:15 |
| 8 | The tool list, the OpenRouter paragraph, and the Cerebras paragraph. Keep Groq and Gemini — latency and Hindi voice are the two that carry a point | 1:00 |
| 9 | The commit-history paragraph and two of the three bugs — keep Dharamshala, it is the one with a place name in it | 0:55 |
| 10 | The handover paragraph | 0:20 |
| | | **≈ 4:55** |

What survives: all four angles, every role, the NDMA and census integration
work, which model does what and why, one failure with its fix, the verification
story, and the replay. Nothing on the submission checklist is lost.

What you must not cut, at any length: the confirm-before-send beat in scene 5,
the triage floor in scene 6, the "model never generates UI" line in scene 8,
and the unreachable-is-not-all-clear line in scene 11. Those four are the
product's whole argument.

---

## If something breaks on camera

Don't cut. This is a disaster tool — degrading gracefully *is* the feature.

| What happens | What you say |
|---|---|
| NDMA feed slow or empty | "And there it is — it says the source is unreachable. It won't tell you all-clear, because those are opposite things." |
| Model rate-limited | "That's the failover working — four providers, all free tier. And notice the panel still answered. The words are the optional part." |
| A panel fails to load | "Every window has a retry, because half these sources are government hosts on a bad day." |
| The agent is slow | Keep talking over it. Never watch a spinner in silence. |

---

## The angles — final checklist

**AI workflow** — flow end to end (Web Speech → client matcher → deterministic
router → tool → fixed panel enum → narration → neural TTS) ✓ · prompt read on
screen ✓ · 17 tools ✓ · which model does what and why: Groq for voice latency,
OpenRouter for breadth, Gemini for Hindi TTS, Cerebras as fourth ✓ · failover ✓
· built with Claude Code: design-first docs, AGENTS.md, commit bodies as build
log ✓ · three failures with fixes ✓ · verification: 358 assertions, 15 suites,
live sources tested live, CI ✓

**Integration** — NDMA portal: poll-based CAP, RSS index + document fetch,
mandatory ETag/304, longitude-first trap, IST trap, Actual/Cancel gates ✓ ·
Census 2011: 118 columns, five kept, 1,210,854,977 checksum, NCP Table 8
projection to 2026 ✓ · Open-Meteo: keyless, 200 coords per call, 4 calls for
India, inside the free tier ✓ · shelters bundled for offline ✓

**Real project** — three logins, all demoed ✓ · real auth, real database, live
URL ✓ · alerts, scan, state deck, SOS, triage, dispatch, missions, chat,
reports, broadcast gate, notifications, orgs, replay, ops, handover ✓ · offline
behaviour ✓

**Impact** — named users, not "stakeholders" ✓ · what changes for each ✓ · why
AI is critical and not decorative ✓ · fatigue ledger and coverage gaps as the
measurable outcome ✓ · what it refuses to do ✓
