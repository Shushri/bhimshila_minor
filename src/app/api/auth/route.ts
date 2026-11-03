import { db, dbReady } from "@/lib/db";
import { clientKey, limited } from "@/lib/ratelimit";
import {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
} from "@/lib/auth";

/** Signup, login, logout and "who am I" — one route, action-dispatched. */

const PHONE = /^[6-9]\d{9}$/; // Indian mobile

export async function GET() {
  const user = await currentUser();
  return Response.json({ user });
}

export async function POST(request: Request) {
  await dbReady();
  const body = (await request.json()) as {
    action: "signup" | "login" | "logout";
    phone?: string;
    password?: string;
    name?: string;
    role?: string;
    place?: string;
    lat?: number;
    lng?: number;
    language?: string;
  };

  if (body.action === "logout") {
    await destroySession();
    return Response.json({ ok: true });
  }

  const phone = (body.phone ?? "").replace(/\D/g, "").slice(-10);
  const password = body.password ?? "";

  if (!PHONE.test(phone)) {
    return Response.json({ error: "Enter a valid 10-digit Indian mobile number." }, { status: 400 });
  }
  if (password.length < 6) {
    return Response.json({ error: "Password must be at least 6 characters." }, { status: 400 });
  }

  if (body.action === "signup") {
    if (limited(`signup:${clientKey(request)}`, 10, 60 * 60_000)) {
      return Response.json({ error: "Too many accounts from this connection — try later." }, { status: 429 });
    }
    const existing = await db().execute({
      sql: "SELECT id FROM users WHERE phone = ?",
      args: [phone],
    });
    if (existing.rows.length) {
      return Response.json({ error: "That number is already registered — log in instead." }, { status: 409 });
    }

    const role = ["citizen", "volunteer", "coordinator"].includes(body.role ?? "")
      ? body.role!
      : "citizen";

    const r = await db().execute({
      sql: `INSERT INTO users (phone, name, password_hash, role, language, place, lat, lng)
            VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
      args: [
        phone,
        (body.name ?? "").trim() || `User ${phone.slice(-4)}`,
        await hashPassword(password),
        role,
        body.language ?? "hi-IN",
        body.place ?? null,
        body.lat ?? null,
        body.lng ?? null,
      ],
    });

    const id = Number(r.rows[0].id);
    await createSession(id);
    return Response.json({ ok: true, user: await currentUser() });
  }

  // login
  const r = await db().execute({
    sql: "SELECT id, password_hash FROM users WHERE phone = ?",
    args: [phone],
  });
  const row = r.rows[0];
  // Same message either way — don't leak which numbers are registered.
  if (!row || !(await verifyPassword(password, String(row.password_hash)))) {
    return Response.json({ error: "Wrong number or password." }, { status: 401 });
  }

  await createSession(Number(row.id));
  return Response.json({ ok: true, user: await currentUser() });
}
