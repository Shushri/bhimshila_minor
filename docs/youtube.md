# YouTube — title and description

## Title

**Recommended**

```
BhimShila — Disaster Intelligence for India, built in 10 days with Claude Code
```

Names the product, the domain, and the hook that makes a build video worth
opening. 77 characters — fits everywhere without truncation.

**Alternates**

```
I built an AI disaster response platform for India — full walkthrough
```
```
BhimShila: every live NDMA alert, ranked by the people underneath it
```
```
Jarvis for disaster management — building BhimShila for India
```

Avoid "AI-powered" in the title. Every submission says it; the specific claim
(ranked by population underneath) is what makes someone click.

---

## Description

Copy everything below the line.

---

Every disaster authority in India already publishes warnings. Almost nobody
downstream can act on them fast enough. BhimShila is what I built to sit in
that gap — it ranks every live government alert by the population underneath
it, takes an SOS spoken in Hinglish, and coordinates the teams that respond.

🔗 Live: https://bhimshila.vercel.app
💻 Source: https://github.com/CyNoGeN1109/bhimshila

Built solo for BestPossible.AI Build Season 2026.

WHAT IT DOES

• Polls NDMA's official Sachet CAP feed — real warnings issued by state
  disaster authorities, the IMD and the Central Water Commission
• Scores all 724 Indian districts continuously on rainfall, forecast, river
  proximity and elevation, using free keyless weather data
• Puts a population figure under every alert, so 40 warnings become a queue
• Takes a citizen SOS by voice in Hindi, English or Hinglish and turns it into
  a structured, ranked incident
• Coordinates the response: nearest team, dispatch, mission threads, ground
  reports with photos, and a broadcast gate so field knowledge flows up while
  authority flows down
• Three logins — district coordinator, NGO volunteer, citizen — each opening
  onto a different product

CHAPTERS

0:00 The boulder that split the Kedarnath flood
1:00 Three people who need completely different things
2:15 Where the data comes from
3:30 How the government data actually got in — CAP, ETags, and two traps
5:45 The coordinator: state deck, alert staging, dispatch
7:30 The citizen: voice SOS and the safety floor
8:45 The volunteer: missions, ground reports, the broadcast gate
10:00 How the AI actually works — router, tools, panels, providers
13:00 How I built it with Claude Code, and where the AI got it wrong
15:45 What actually changes: alert fatigue and coverage gaps
17:15 What BhimShila is not

THE RULES IT IS BUILT ON

• The model never generates the interface — it picks from a fixed set of panels
• The panel is the source of truth; the model only narrates it
• AI can propose a dispatch or an alert. It can never execute one
• Facts are computed, language is generated — never the other way round
• When a source is unreachable it says unreachable, never "all clear"

WHAT IT IS NOT

Not a forecasting system — it reads what the IMD and CWC publish and cites
them. Not autonomous — nothing reaches a person without a coordinator's
confirmation. And it does not pretend: a channel is only reported as delivered
if something genuinely left the building.

BUILT WITH

Next.js 16 · TypeScript · libsql/Turso · Vercel · GitHub Actions
NDMA Sachet (CAP 1.2) · Open-Meteo forecast + 1940 archive · GloFAS river
discharge · USGS · OpenStreetMap · Census 2011 with official 2026 projections
OpenRouter · Groq · Gemini · Web Speech API

Verified by 16 test suites and 400+ assertions, with the live government
sources tested live on purpose — a frozen fixture keeps passing after the feed
changes underneath it.

#DisasterManagement #India #AI #ClaudeCode #NextJS #OpenSource #NDMA

---

## Before you publish

- **Fix the chapter times.** Those are from the plan, not the cut. YouTube only
  builds a chapter list if the first stamp is `0:00` and there are at least
  three, each 10s or longer.
- **Thumbnail:** the India map with the state glow, or the Khaniyara replay
  chart at the moment it crosses HIGH. Not a face, not a logo.
- **Pinned comment:** the live URL again — most people never open a description.
