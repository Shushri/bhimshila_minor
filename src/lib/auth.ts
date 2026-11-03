import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { db, dbReady } from "./db";

/**
 * Real authentication, not a mock-up — and no paid service.
 *
 * scrypt-hashed passwords (Node's built-in, memory-hard KDF), random session
 * tokens stored server-side as SHA-256 hashes, httpOnly cookies. Phone-number
 * OTP would need an SMS provider and money; credentials + server sessions is
 * the honest free equivalent, and it is genuinely real auth.
 */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

const COOKIE = "dai_session";
const SESSION_DAYS = 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const key = await scrypt(password, Buffer.from(saltHex, "hex"), 64);
  const expected = Buffer.from(keyHex, "hex");
  return key.length === expected.length && timingSafeEqual(key, expected);
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export interface SessionUser {
  id: number;
  phone: string;
  name: string;
  role: "citizen" | "volunteer" | "coordinator";
  language: string;
  place: string | null;
  lat: number | null;
  lng: number | null;
}

export async function createSession(userId: number): Promise<void> {
  await dbReady();
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db().execute({
    sql: "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?,?,?)",
    // SQLite's datetime format, not ISO-8601 — expiry is compared against
    // datetime('now') as a string, and the two formats only collate correctly
    // by the accident that 'T' sorts above ' '.
    args: [hashToken(token), userId, expires.toISOString().replace("T", " ").slice(0, 19)],
  });
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function destroySession(): Promise<void> {
  await dbReady();
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await db().execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [hashToken(token)] });
  }
  jar.delete(COOKIE);
}

/** Null when not logged in — routes decide whether that is fatal. */
export async function currentUser(): Promise<SessionUser | null> {
  await dbReady();
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const r = await db().execute({
    sql: `SELECT u.id, u.phone, u.name, u.role, u.language, u.place, u.lat, u.lng
          FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
    args: [hashToken(token)],
  });
  const row = r.rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    phone: String(row.phone),
    name: String(row.name),
    role: String(row.role) as SessionUser["role"],
    language: String(row.language),
    place: row.place === null ? null : String(row.place),
    lat: row.lat === null ? null : Number(row.lat),
    lng: row.lng === null ? null : Number(row.lng),
  };
}

/** For routes that must be authenticated. */
export async function requireUser(): Promise<SessionUser> {
  const u = await currentUser();
  if (!u) throw new AuthError("Login required");
  return u;
}

export class AuthError extends Error {}
