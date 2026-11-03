# Need and gap — research behind BhimShila

Every claim below is sourced. This exists because a product built on an
assumed problem is a guess; a product built on a documented one is a bet with
better odds. Three angles, matching the three logins: the coordinator, the
field volunteer, the citizen.

---

## 1 · The coordinator's problem: information exists, coordination doesn't

### The pattern is global, and it has a name

The UN's humanitarian "cluster system" exists specifically because agencies
responding to the same disaster don't share information by default. A paper
on standardised data collection in humanitarian settings documents what that
costs in practice, with three concrete cases:

- After the **Aceh tsunami**, duplicated vaccination drives meant "some
  children had received up to four measles vaccinations." [PMC9540843](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540843/)
- After the **2010 Haiti earthquake**, "some areas of the country were
  receiving duplicated services while others had no access." The same paper
  notes Haiti's post-earthquake needs assessment "cost about 3 million
  dollars," and "when the results were finally released, they were obsolete
  and no longer reliable." [PMC9540843](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540843/)
- During the **Ethiopia famine response**, "surveys were collected
  simultaneously, with some areas duplicated and lacking representation in
  others" — and those flawed surveys were still used to justify funding
  decisions. [PMC9540843](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540843/)

The paper's own diagnosis of the root cause: "many groups and agencies each
have their donors, ideas and agendas that need to be fulfilled and do not
feel the need to share their information with others." [PMC9540843](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540843/)
Not malice — structure. Nobody owns the shared picture, so nobody sees it.

### India's own worst case is on the record, in the minister's own words

The **2013 Kedarnath disaster** (Uttarakhand) is where this stopped being
abstract. Reporting on the response describes "utter chaos in the
administration with bureaucrats sitting inside expensive hotels screaming on
their mobile phones, and at the Rudraprayag police control room, no one knew
what action to take." It took the Union Home Minister, Sushil Kumar Shinde,
travelling to Uttarakhand in person to admit publicly that "there was no
coordination among government agencies, which was hampering rescue
operations." [Tribune India, 2013](https://www.tribuneindia.com/2013/20130621/main1.htm)

That the eventual evacuation — 108,653 people — still ranks among India's
largest and swiftest is the finding that matters most for this project: the
capacity was there. The coordination layer was not.

### The workaround, when it works, is a human being with a phone and a spreadsheet

The **2018 Kerala floods** are the counter-example that proves the same
point from the other direction. More than 400 volunteers ran the Amrita
Helpline, a 24-hour call centre, and in five days fielded "more than 25,000
calls" and connected "over 100,000 flood victims with appropriate relief
services." Separately, college students "created a database to assess the
needs of each camp… and direct supply trucks accordingly." [ReliefWeb / Amrita case study](https://reliefweb.int/report/india/nss-volunteers-taking-part-large-number-kerala-flood-relief-measures)

That is 100,000 people matched to help by volunteers manually triaging phone
calls into a database, because no system did it for them. It worked — Kerala
2018 is widely cited as a coordination success — but it worked at the cost of
400 people doing by hand exactly the matching problem this platform's
dispatch board exists to do in software: an incident, a nearest available
team, a confirmed assignment, a record of what happened and when.

### What this maps to

BhimShila's ops board (`/api/ops`), the confirm-before-send gate on every
dispatch and alert, and the coordinator-only broadcast approval are a direct
answer to "who owns the shared picture" — one board, one queue, every
decision logged with who made it and when, rather than a call centre's
whiteboard. The alert-fatigue ledger and coverage-gap view go a step further
than any of the sources above describe: none of the case studies mention a
system that flags *quietly failing* coverage before someone has to notice
the hard way, which is the specific gap those two features are built for.

What isn't addressed, honestly: none of this research validates cross-agency
adoption — every source above is about coordination *within or between*
large actors (UN clusters, Red Cross, government). BhimShila is
single-tenant per organisation today; whether it generalises to
inter-agency use the way this research describes is untested.

---

## 2 · The field worker's problem: no connectivity, no training time, and being asked twice

### The infrastructure the job depends on is the first thing that breaks

"During disasters in India, entire villages have lost connectivity, which
directly impacts relief operations. Civilian communication infrastructure
cannot be relied upon to be available in case of disasters." [Voyeda field-connectivity brief](https://voyedatapool.com/blog/ngo-field-connectivity/)
Aid workers still "depend on uninterrupted internet access to coordinate
emergency response, communicate with headquarters, monitor relief
distribution, collect beneficiary data, and ensure the safety of teams" —
the job assumes exactly the resource the disaster removes.

### There is no time to teach anyone how to use the tool

A study on India's disaster-app ecosystem makes a point that is easy to miss
and hard to overstate: "having trained volunteers to use disaster management
apps" is a major problem, because "it is not possible to develop this
knowledge during an actual disaster." [Mongabay India, 2020](https://india.mongabay.com/2020/01/study-finds-limited-outreach-of-disaster-related-mobile-apps-in-india/)
Whatever interface a field worker gets handed, they get handed it for the
first time in the field, under pressure, or not at all.

### The apps that exist mostly don't get used

The same Mongabay study analysed 33 Android disaster-management apps in
India. Excluding three globally-focused outliers, the remaining 26 averaged
**1,119 downloads each** — against a population of 1.35 billion and 300+
million smartphone users. The paper's own word for that reach: "almost
negligible." [Mongabay India, 2020](https://india.mongabay.com/2020/01/study-finds-limited-outreach-of-disaster-related-mobile-apps-in-india/)
The named reasons: bad interfaces, no language inclusivity, and — the one
worth sitting with — no integration with the platforms people already use,
WhatsApp and SMS specifically named.

### What this maps to

Every mission-status change, ground report, and SOS in BhimShila queues
locally and syncs on reconnect — built for the "entire village lost
connectivity" case directly, not retrofitted onto an always-online
assumption. The voice-first design for the citizen and volunteer layers is
the direct answer to "no time to train anyone" — there is nothing to learn
if the interface is a sentence in whatever language you already speak.
Telegram delivery (not a bespoke app) is the direct answer to "no
integration with platforms people already use," and Sachet-name-verbatim
alert text targets "no language inclusivity" specifically.

What isn't addressed, honestly: the research is about volunteers using
*disaster apps* in general, not disaster-coordination apps like this one
specifically, so it's suggestive rather than a direct verdict on BhimShila's
own interface. And WhatsApp — the platform actually named in the research
as the integration people expect — isn't live; Telegram is the one that
shipped, because it doesn't require Meta Business verification. That gap
between what the research says people use and what the product currently
delivers to is real and should be named as such, not glossed over.

---

## 3 · The citizen's problem: the warning exists and doesn't reach them, or reaches them and they don't act

### Coverage is worse than it looks, and the state this project is anchored on is one of the worst

CEEW's analysis of India's early warning systems: "only 33 per cent of the
exposed individuals are covered by flood EWS," against 66% of the population
actually facing flood exposure. Cyclone coverage, by contrast, reaches 100%
of exposed people. Flood coverage is the far weaker system. [CEEW, 2023](https://www.ceew.in/publications/how-can-india-strengthen-climate-disaster-preparedness-with-multi-hazard-effective-early-warning-systems)

The states named as having "the lowest availability of flood EWS" despite
high exposure: **Tamil Nadu, Himachal Pradesh, Karnataka, and Telangana.**
Himachal Pradesh — Kangra, Dharamshala, the Khaniyara flash flood this
platform's replay mode reconstructs — is on that list by name, not by
inference. [CEEW, 2023](https://www.ceew.in/publications/how-can-india-strengthen-climate-disaster-preparedness-with-multi-hazard-effective-early-warning-systems)

Fund utilisation compounds it: only 6 of 32 flood-exposed states show even
"moderate" utilisation of the money allocated for this. [CEEW, 2023](https://www.ceew.in/publications/how-can-india-strengthen-climate-disaster-preparedness-with-multi-hazard-effective-early-warning-systems)

### NDMA's own platform — the one this project polls — reaches a fraction of the country

Sachet has "over 500,000 downloads" on the Play Store and an NDMA dashboard
figure of "861,000 mobile application users across India." [MSC / Microsave, 2025](https://www.microsave.net/2025/07/24/turning-the-tide-how-indias-sachet-system-is-reshaping-disaster-preparedness/)
Against 1.4 billion people, that is not a criticism of Sachet's data — the
data is real and official, and this project treats it as authoritative for
exactly that reason — it is a description of how far a single official app
travels on its own. Sachet also broadcasts over TV, radio, and cell-broadcast
SMS, which reach further than the app alone; but broadcast channels are
one-way. None of them can take a structured SOS back.

### When a warning is issued, "issued" and "acted on" are different events

The **2024 Wayanad landslides** killed over 260 people. Meteorological
authorities issued warnings about heavy rainfall and landslide risk in
advance — the failure was downstream: "local governments failed to organize
timely evacuations." Several of the exact villages that were buried had
already been flagged as high-sensitivity landslide-risk zones in official
hazard assessments as early as **2020**. The disaster's own post-mortem
names the gap plainly: "a significant gap between identification of
hazard-prone areas and actual preparedness measures on the ground." [ScienceDirect preliminary analysis, 2025](https://www.sciencedirect.com/science/article/pii/S2666592125000472)

This is the exact gap BhimShila is named for and built to sit inside — not
the forecast, not the risk score, but the space between a warning being
correct and a person being moved because of it.

### And when warnings do arrive too often, people stop listening

Cell Broadcast has made India's alerts more frequent, and "disaster
management experts are raising concerns about weather alert fatigue,"
where "repeated notifications can lead to complacency" and genuine warnings
get "ignored or dismissed as false alarms." [RMAI India](https://rmaindia.org/frequent-weather-warnings-raise-concerns-over-public-alert-fatigue/)
Documented false-alarm incidents make the erosion concrete: a tsunami siren
"erroneously started playing" in Porvorim, Goa, and a test message from
India's Tsunami Early Warning Centre "escaped from the internal system to
the public," taking two hours to correct. [Deccan Herald](https://www.deccanherald.com/india/goa/false-tsunami-alert-triggers-panic-at-porvorim-in-goa-probe-ordered-2676664) · [ANU mailing list](https://mailman.anu.edu.au/pipermail/link/2018-June/037614.html)

### The rigorous evidence on what actually changes citizen behaviour

A J-PAL randomised evaluation across 319 rural panchayats in Bihar is the
strongest evidence in this whole set, because it's a controlled comparison,
not a case study. Baseline conditions in the study villages: **only one in
five respondents used a smartphone**, and literacy sat around 70% overall,
which the study notes directly limits SMS effectiveness. [J-PAL](https://www.povertyactionlab.org/evaluation/disseminating-flood-warnings-increase-disaster-preparedness-india)

Comparing community-based dissemination (trained local volunteers relaying
alerts) against alerts-only (a smartphone push with no human layer), the
volunteer-assisted communities saw:

- **2.37 more alerts on average — a 290% increase**
- **27%** higher likelihood of receiving any alert at all
- **46.5%** greater probability the alert arrived *before* the water did
- **57%** more likely to report the alert as highly accurate

And the mechanism underneath all four numbers: "households typically relied
on other community members for flood alerts." [J-PAL](https://www.povertyactionlab.org/evaluation/disseminating-flood-warnings-increase-disaster-preparedness-india)
Not the phone. The person who told them.

### What this maps to

This is the single research finding that most validates a specific design
decision in this product: voice, not a form, is not a UX preference here —
it is the same mechanism J-PAL measured, just running through a phone
instead of a neighbour, and it is why the citizen SOS flow asks for one
sentence in whatever language was actually spoken rather than a multi-field
form. The Sachet-first, cite-the-authority approach is the direct response to
"issued and acted on are different events" — this project doesn't try to
out-forecast Wayanad's problem, it tries to close the gap after the warning
by putting the citizen's next action (nearest shelter, what to do, an SOS)
one tap or one sentence away from the alert itself. The alert-fatigue ledger
is the direct, measurable answer to the Cell Broadcast complacency problem —
not a guess that fatigue exists, a running count of exactly where it is.

What isn't addressed, honestly: the J-PAL result is about *volunteer relay*
outperforming *alerts alone* — it is not evidence that a voice-driven app
outperforms a volunteer standing in the village. This project's bet is that
voice can approximate some of what a trusted human relay does (low
literacy/low-smartphone-friendly, no reading required), but that is an
inference from the mechanism, not something the cited study tested
directly. And smartphone penetration in the exact populations most exposed
to flood risk (rural Bihar: 1 in 5) is a real ceiling on how far *any*
app-based citizen channel reaches — voice or not, in-app or Telegram, the
device still has to be in someone's hand.

---

## Sources

| # | Source | Used for |
|---|---|---|
| 1 | [PMC9540843 — standardised data collection in humanitarian settings](https://pmc.ncbi.nlm.nih.gov/articles/PMC9540843/) | Aceh/Haiti/Ethiopia duplication cases |
| 2 | [Humanitarian Cluster System, background](https://disasterphilanthropy.org/cdp-resource/un-cluster-approach/) | Why the cluster system exists |
| 3 | [ReliefWeb — Kerala 2018, NSS volunteers / Amrita Helpline](https://reliefweb.int/report/india/nss-volunteers-taking-part-large-number-kerala-flood-relief-measures) | Manual-coordination-at-scale case |
| 4 | [Tribune India, 2013 — Uttarakhand special coverage](https://www.tribuneindia.com/2013/20130621/main1.htm) | Kedarnath coordination admission |
| 5 | [Voyeda — NGO field connectivity](https://voyedatapool.com/blog/ngo-field-connectivity/) | Field connectivity loss |
| 6 | [Mongabay India, 2020 — disaster app outreach study](https://india.mongabay.com/2020/01/study-finds-limited-outreach-of-disaster-related-mobile-apps-in-india/) | App download/reach data, training barrier |
| 7 | [CEEW, 2023 — multi-hazard early warning systems](https://www.ceew.in/publications/how-can-india-strengthen-climate-disaster-preparedness-with-multi-hazard-effective-early-warning-systems) | Flood EWS coverage %, state rankings |
| 8 | [Microsave/MSC, 2025 — Sachet system](https://www.microsave.net/2025/07/24/turning-the-tide-how-indias-sachet-system-is-reshaping-disaster-preparedness/) | Sachet user numbers |
| 9 | [ScienceDirect — Wayanad landslide 2024 preliminary analysis](https://www.sciencedirect.com/science/article/pii/S2666592125000472) | Warning-issued-but-not-acted-on case |
| 10 | [RMAI India — weather alert fatigue](https://rmaindia.org/frequent-weather-warnings-raise-concerns-over-public-alert-fatigue/) | Alert fatigue in Cell Broadcast era |
| 11 | [Deccan Herald — Goa tsunami false alarm](https://www.deccanherald.com/india/goa/false-tsunami-alert-triggers-panic-at-porvorim-in-goa-probe-ordered-2676664) | False-alarm example |
| 12 | [J-PAL — flood warning dissemination RCT, Bihar](https://www.povertyactionlab.org/evaluation/disseminating-flood-warnings-increase-disaster-preparedness-india) | Rigorous citizen-behaviour evidence |
| 13 | [IndiaSpend/iSignal — why India's EWS fall short](https://www.isignal.in/explainers/why-indias-early-warning-systems-for-floods-and-cyclones-fall-short-825110) | Expert quotes, forecast lead time, Ockhi |

---

## What this changes about how the product is described

Three claims this research supports well enough to say out loud, and three
it does not:

**Can say:** the coordination gap during Indian disasters is on the record
in a minister's own words, not a hypothesis (Kedarnath). Himachal Pradesh
specifically is named as under-covered for flood EWS despite exposure — this
project's own anchor state. Voice-first citizen input is not a UX
preference; it approximates the exact mechanism (a trusted relay, not a
form) that a randomised study measured actually changing outcomes.

**Cannot say:** that this product closes the inter-agency coordination gap
(the research is about agencies talking past each other; this is
single-tenant per org). That voice-driven alerts have been shown to
outperform a human volunteer relay (the J-PAL result is suggestive, not a
direct test of this product). That WhatsApp integration solves the
"integrate with platforms people use" finding — the research names WhatsApp
specifically, and what shipped is Telegram, because it doesn't need Meta
Business verification. That gap is worth being honest about in a pitch
before a judge finds it first.
