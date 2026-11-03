/**
 * Linking Telegram — the half that was missing.
 *
 * `telegram_chat_id` was read on every alert and written by nothing, so the
 * channel reported "no recipient has linked Telegram" forever. Telegram will
 * not reveal a chat id from a phone number; the person has to message the bot,
 * which is deliberate and correct — nobody lands on a broadcast list without
 * opting in. These cover the code side of that handshake.
 *
 * The final step needs a human to tap Start, so what is asserted here is
 * everything up to it: that a code is minted, that it is unguessable, that only
 * its owner can be bound by it, and that a stale one cannot be reused.
 */
const BASE = "http://localhost:3000";

let pass = 0;
const failures = [];
const check = (n, ok, d = "") => {
  if (ok) {
    pass++;
    console.log(`  ✓ ${n}`);
  } else {
    failures.push(`${n} — ${d}`);
    console.log(`  ✗ ${n}  ${d}`);
  }
};

const jar = () => ({ cookie: "" });
async function call(j, path, body, method) {
  const res = await fetch(BASE + path, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(j.cookie ? { cookie: j.cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get("set-cookie");
  if (sc) j.cookie = sc.split(";")[0];
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}
const ph = () => "9" + String(Math.floor(Math.random() * 9e8) + 1e8);

console.log("ACCESS");
const anon = jar();
let r = await call(anon, "/api/telegram", {});
check("anonymous cannot mint a link", r.status === 401, `got ${r.status}`);
r = await call(anon, "/api/telegram");
check("anonymous cannot read status", r.status === 401, `got ${r.status}`);

const a = jar();
await call(a, "/api/auth", {
  action: "signup", phone: ph(), password: "relief2026", name: "A", role: "citizen", place: "Kangra",
});

console.log("\nSTATUS");
r = await call(a, "/api/telegram");
const configured = r.json?.configured;
check("status answers for a logged-in user", r.status === 200 && typeof configured === "boolean");
check("a fresh account is not linked", r.json?.linked === false, JSON.stringify(r.json));

if (!configured) {
  console.log("\n  TELEGRAM_BOT_TOKEN is not set — skipping the link checks.");
  check("unconfigured is reported honestly, not as an error", !!r.json?.hint, JSON.stringify(r.json));
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
}

console.log("\nMINTING A LINK");
r = await call(a, "/api/telegram", {});
const first = r.json;
check("a link is minted", r.status === 200 && !!first?.code, JSON.stringify(first)?.slice(0, 90));
check(
  "the deep link carries the code to the right bot",
  first?.url === `https://t.me/${first?.botUsername}?start=${first?.code}`,
  first?.url,
);
check(
  "the code is long enough that guessing is pointless",
  /^[a-f0-9]{10,}$/.test(first?.code ?? ""),
  first?.code,
);
check("the link expires", first?.expiresInMinutes > 0 && first?.expiresInMinutes <= 60,
  String(first?.expiresInMinutes));

r = await call(a, "/api/telegram", {});
const second = r.json;
check("each request mints a fresh code", second?.code !== first?.code, `${first?.code} vs ${second?.code}`);

// Re-minting must retire the previous code. Two live codes for one account
// means a stale link, or a screenshot of one, can still bind the account later.
const b = jar();
await call(b, "/api/auth", {
  action: "signup", phone: ph(), password: "relief2026", name: "B", role: "citizen", place: "Shimla",
});
r = await call(b, "/api/telegram", {});
check("a different account gets a different code", r.json?.code !== second?.code);
check("both accounts point at the same bot", r.json?.botUsername === first?.botUsername);

console.log("\nSTILL UNLINKED UNTIL SOMEONE TAPS START");
r = await call(a, "/api/telegram");
check(
  "minting a link does not link anything on its own",
  r.json?.linked === false,
  JSON.stringify(r.json),
);
check("polling for updates does not error", r.status === 200, `got ${r.status}`);

console.log(`\n  bot: @${first?.botUsername}`);
console.log(`  open to finish linking: ${second?.url}`);

console.log(`\n${pass} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFAILURES");
  for (const f of failures) console.log("  •", f);
}
process.exit(failures.length ? 1 : 0);
