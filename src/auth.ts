const SESSION_COOKIE = "osqr_session";
const SESSION_DAYS = 30;

export interface SessionUser {
  id: string;
  email: string;
  plan: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Edge-friendly password hash (pepper + salt + SHA-256). */
export async function hashPassword(password: string, pepper: string): Promise<string> {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bytesToHex(saltBytes);
  const msg = new TextEncoder().encode(`${pepper}\0${salt}\0${password}`);
  const digest = await crypto.subtle.digest("SHA-256", msg);
  return `s256$${salt}$${bytesToHex(new Uint8Array(digest))}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length === 3 && parts[0] === "s256") {
    const salt = parts[1];
    const expected = parts[2];
    const msg = new TextEncoder().encode(`${pepper}\0${salt}\0${password}`);
    const digest = await crypto.subtle.digest("SHA-256", msg);
    return bytesToHex(new Uint8Array(digest)) === expected;
  }

  // Legacy PBKDF2 hashes from early deploys (local dev only).
  if (parts.length === 4 && parts[0] === "pbkdf2") {
    const iterations = Number(parts[1]);
    const salt = hexToBytes(parts[2]);
    const expected = parts[3];
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    );
    return bytesToHex(new Uint8Array(bits)) === expected;
  }

  return false;
}

export function sessionCookieHeader(sessionId: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export function readSessionId(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionExpiresAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + SESSION_DAYS);
  return d.toISOString();
}

export function isSessionValid(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() > Date.now();
}

export { SESSION_COOKIE, SESSION_DAYS };
