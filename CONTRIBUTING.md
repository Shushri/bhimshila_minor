# Working on this

## Setup

```bash
npm install
cp .env.local.example .env      # add your own keys — never commit .env
npm run dev
```

`.env` is gitignored and has never been committed. Keep it that way: the keys in
it are real.

## Before you push

```bash
npx tsc --noEmit                # must be clean
npx eslint src --ext .ts,.tsx   # must be clean
npm run dev                     # then, in another terminal:
node test/testall.mjs && node test/missions.mjs && node test/router.mjs
```

Every suite is rerunnable against a database that already has history. If one
only passes on a fresh `data/dai.db`, that is a bug in the check — it means the
fixture is reusing the world, and it will fail for the next person.

## What the checks are for

Most exist because something broke silently. `test/README.md` says what each one
is really protecting; read that before changing one. A check that starts failing
is more often telling you something true than being out of date.

## The one rule

**The model reads and writes language. It never produces a number that decides
who is in danger or who gets help first.**

Risk scores, severity, priority and ranking live in plain code with readable
weights. If a change would let a model produce one of those, it needs a
conversation first — that boundary is the product, not an implementation detail.

## Conventions

- No new dependency without a reason that survives being said out loud.
- Comments explain *why*, especially where the obvious approach was wrong.
- A channel is reported as delivered only if something actually left the
  building. An unreachable source is reported as unreachable, never as "nothing
  to report".
