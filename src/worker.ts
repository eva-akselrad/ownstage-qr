import {
  clearSessionCookieHeader,
  hashPassword,
  isSessionValid,
  readSessionId,
  sessionCookieHeader,
  sessionExpiresAt,
  SessionUser,
  verifyPassword,
} from "./auth";

export interface Env {
  DB: D1Database;
  LINKS: KVNamespace;
  ASSETS: Fetcher;
  PUBLIC_BASE_URL: string;
  AUTH_PEPPER: string;
}

function pepper(env: Env): string {
  if (!env.AUTH_PEPPER) {
    throw new Error("AUTH_PEPPER is not configured");
  }
  return env.AUTH_PEPPER;
}

interface LinkRow {
  id: string;
  user_id: string | null;
  destination: string;
  token_hash: string;
  label: string | null;
  created_at: string;
  updated_at: string;
}

interface LegacyLinkRecord {
  url: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
}

const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const FREE_LINK_LIMIT = 25;

const PLAN_LIMITS: Record<string, number> = {
  free: FREE_LINK_LIMIT,
  pro: 500,
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  for (const [key, value] of Object.entries(extraHeaders)) {
    if (key.toLowerCase() === "set-cookie") {
      headers.append("Set-Cookie", value);
    } else {
      headers.set(key, value);
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function error(message: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return json({ error: message }, status, extraHeaders);
}

function randomId(length = 8): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (let i = 0; i < length; i++) {
    out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  }
  return out;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isValidId(id: string): boolean {
  return /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{6,12}$/.test(id);
}

function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

async function getUserFromSession(request: Request, env: Env): Promise<SessionUser | null> {
  const sessionId = readSessionId(request);
  if (!sessionId) return null;
  const row = await env.DB.prepare(
    `SELECT s.expires_at, u.id, u.email, u.plan
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = ?`,
  )
    .bind(sessionId)
    .first<{ expires_at: string; id: string; email: string; plan: string }>();
  if (!row || !isSessionValid(row.expires_at)) return null;
  return { id: row.id, email: row.email, plan: row.plan };
}

async function readLinkRow(env: Env, id: string): Promise<LinkRow | null> {
  return env.DB.prepare(`SELECT * FROM links WHERE id = ?`).bind(id).first<LinkRow>();
}

async function readLegacyLink(env: Env, id: string): Promise<LegacyLinkRecord | null> {
  const raw = await env.LINKS.get(id);
  if (!raw) return null;
  return JSON.parse(raw) as LegacyLinkRecord;
}

async function resolveDestination(env: Env, id: string): Promise<string | null> {
  const row = await readLinkRow(env, id);
  if (row) return row.destination;
  const legacy = await readLegacyLink(env, id);
  return legacy?.url ?? null;
}

function linkLimitForPlan(plan: string): number {
  return PLAN_LIMITS[plan] ?? PLAN_LIMITS.free;
}

function linkPayload(
  base: string,
  row: LinkRow,
  editToken?: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id: row.id,
    destination: row.destination,
    shortUrl: `${base}/r/${row.id}`,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    managePath: `/manage/${row.id}`,
  };
  if (editToken) payload.editToken = editToken;
  return payload;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");

    if (url.pathname.startsWith("/r/")) {
      const id = url.pathname.slice(3).split("/")[0];
      if (!isValidId(id)) return error("Not found", 404);
      const destination = await resolveDestination(env, id);
      if (!destination) return error("This link does not exist.", 404);
      return Response.redirect(destination, 302);
    }

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
          "access-control-allow-headers": "content-type, authorization",
        },
      });
    }

    if (url.pathname === "/api/auth/signup" && request.method === "POST") {
      try {
        let body: { email?: string; password?: string };
        try {
          body = await request.json();
        } catch {
          return error("Invalid JSON body.", 400);
        }
        const email = normalizeEmail(body.email ?? "");
        const password = body.password ?? "";
        if (!email) return error("Enter a valid email.", 400);
        if (password.length < 8) return error("Password must be at least 8 characters.", 400);

        const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
          .bind(email)
          .first();
        if (existing) return error("An account with this email already exists.", 409);

        const userId = randomId(12);
        const passwordHash = await hashPassword(password, pepper(env));
        const now = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO users (id, email, password_hash, plan, created_at) VALUES (?, ?, ?, 'free', ?)`,
        )
          .bind(userId, email, passwordHash, now)
          .run();

        const sessionId = randomToken();
        await env.DB.prepare(
          `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
        )
          .bind(sessionId, userId, sessionExpiresAt(), now)
          .run();

        const maxAge = 30 * 24 * 60 * 60;
        return json(
          { user: { id: userId, email, plan: "free" } },
          201,
          { "set-cookie": sessionCookieHeader(sessionId, maxAge) },
        );
      } catch (err) {
        console.error("signup failed", err);
        return error("Could not create account. Try again in a moment.", 500);
      }
    }

    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      let body: { email?: string; password?: string };
      try {
        body = await request.json();
      } catch {
        return error("Invalid JSON body.", 400);
      }
      const email = normalizeEmail(body.email ?? "");
      const password = body.password ?? "";
      if (!email || !password) return error("Email and password required.", 400);

      const user = await env.DB.prepare(
        `SELECT id, email, password_hash, plan FROM users WHERE email = ?`,
      )
        .bind(email)
        .first<{ id: string; email: string; password_hash: string; plan: string }>();
      if (!user || !(await verifyPassword(password, user.password_hash, pepper(env)))) {
        return error("Invalid email or password.", 401);
      }

      const sessionId = randomToken();
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
      )
        .bind(sessionId, user.id, sessionExpiresAt(), now)
        .run();

      const maxAge = 30 * 24 * 60 * 60;
      return json(
        { user: { id: user.id, email: user.email, plan: user.plan } },
        200,
        { "set-cookie": sessionCookieHeader(sessionId, maxAge) },
      );
    }

    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      const sessionId = readSessionId(request);
      if (sessionId) {
        await env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
      }
      return json({ ok: true }, 200, { "set-cookie": clearSessionCookieHeader() });
    }

    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      const user = await getUserFromSession(request, env);
      if (!user) return error("Not signed in.", 401);
      const count = await env.DB.prepare(`SELECT COUNT(*) as n FROM links WHERE user_id = ?`)
        .bind(user.id)
        .first<{ n: number }>();
      const limit = linkLimitForPlan(user.plan);
      return json({
        user,
        usage: { links: count?.n ?? 0, limit },
      });
    }

    if (url.pathname === "/api/links" && request.method === "GET") {
      const user = await getUserFromSession(request, env);
      if (!user) return error("Sign in to view your QR codes.", 401);
      const { results } = await env.DB.prepare(
        `SELECT * FROM links WHERE user_id = ? ORDER BY updated_at DESC`,
      )
        .bind(user.id)
        .all<LinkRow>();
      return json({
        links: (results ?? []).map((row) => linkPayload(base, row)),
      });
    }

    if (url.pathname === "/api/links" && request.method === "POST") {
      const user = await getUserFromSession(request, env);
      if (!user) return error("Create a free account to save and manage QR codes.", 401);

      const count = await env.DB.prepare(`SELECT COUNT(*) as n FROM links WHERE user_id = ?`)
        .bind(user.id)
        .first<{ n: number }>();
      const limit = linkLimitForPlan(user.plan);
      if ((count?.n ?? 0) >= limit) {
        return error(`Plan limit reached (${limit} QR codes). Upgrade coming soon.`, 403);
      }

      let body: { url?: string; label?: string };
      try {
        body = await request.json();
      } catch {
        return error("Invalid JSON body.", 400);
      }
      const destination = normalizeUrl(body.url ?? "");
      if (!destination) return error("Enter a valid http(s) URL.", 400);
      const label = (body.label ?? "").trim().slice(0, 80) || null;

      const id = randomId(8);
      const editToken = randomToken();
      const tokenHash = await hashToken(editToken);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO links (id, user_id, destination, token_hash, label, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(id, user.id, destination, tokenHash, label, now, now)
        .run();

      const row = await readLinkRow(env, id);
      if (!row) return error("Could not create link.", 500);
      return json(linkPayload(base, row, editToken), 201);
    }

    const verifyMatch = url.pathname.match(/^\/api\/links\/([^/]+)\/verify$/);
    if (verifyMatch && request.method === "POST") {
      const id = verifyMatch[1];
      if (!isValidId(id)) return error("Not found", 404);
      let body: { token?: string };
      try {
        body = await request.json();
      } catch {
        return error("Invalid JSON body.", 400);
      }
      const token = body.token?.trim() ?? "";
      if (!token) return error("Missing edit token.", 401);

      const row = await readLinkRow(env, id);
      if (row) {
        if ((await hashToken(token)) !== row.token_hash) {
          return error("Invalid edit token.", 403);
        }
        return json({ ok: true });
      }
      const legacy = await readLegacyLink(env, id);
      if (!legacy || (await hashToken(token)) !== legacy.tokenHash) {
        return error("Invalid edit token.", 403);
      }
      return json({ ok: true });
    }

    const match = url.pathname.match(/^\/api\/links\/([^/]+)$/);
    if (match) {
      const id = match[1];
      if (!isValidId(id)) return error("Not found", 404);

      if (request.method === "GET") {
        const row = await readLinkRow(env, id);
        if (row) return json(linkPayload(base, row));
        const legacy = await readLegacyLink(env, id);
        if (!legacy) return error("Not found", 404);
        return json({
          id,
          destination: legacy.url,
          shortUrl: `${base}/r/${id}`,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt,
          managePath: `/manage/${id}`,
          legacy: true,
        });
      }

      if (request.method === "PATCH") {
        let body: { url?: string; label?: string };
        try {
          body = await request.json();
        } catch {
          return error("Invalid JSON body.", 400);
        }

        const user = await getUserFromSession(request, env);
        const auth = request.headers.get("authorization") ?? "";
        const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";

        const row = await readLinkRow(env, id);
        if (row) {
          const ownsLink = user?.id === row.user_id;
          const tokenOk = bearer && (await hashToken(bearer)) === row.token_hash;
          if (!ownsLink && !tokenOk) return error("Not allowed to edit this QR.", 403);

          const destination = body.url !== undefined ? normalizeUrl(body.url) : row.destination;
          if (!destination) return error("Enter a valid http(s) URL.", 400);
          const label =
            body.label !== undefined ? (body.label.trim().slice(0, 80) || null) : row.label;
          const now = new Date().toISOString();
          await env.DB.prepare(
            `UPDATE links SET destination = ?, label = ?, updated_at = ? WHERE id = ?`,
          )
            .bind(destination, label, now, id)
            .run();
          const updated = await readLinkRow(env, id);
          if (!updated) return error("Not found", 404);
          return json(linkPayload(base, updated));
        }

        const legacy = await readLegacyLink(env, id);
        if (!legacy) return error("Not found", 404);
        if (!bearer || (await hashToken(bearer)) !== legacy.tokenHash) {
          return error("Missing or invalid edit token.", 403);
        }
        const destination = normalizeUrl(body.url ?? "");
        if (!destination) return error("Enter a valid http(s) URL.", 400);
        legacy.url = destination;
        legacy.updatedAt = new Date().toISOString();
        await env.LINKS.put(id, JSON.stringify(legacy));
        return json({
          id,
          destination: legacy.url,
          shortUrl: `${base}/r/${id}`,
          updatedAt: legacy.updatedAt,
          legacy: true,
        });
      }

      if (request.method === "DELETE") {
        const user = await getUserFromSession(request, env);
        if (!user) return error("Sign in required.", 401);
        const row = await readLinkRow(env, id);
        if (!row || row.user_id !== user.id) return error("Not found", 404);
        await env.DB.prepare(`DELETE FROM links WHERE id = ?`).bind(id).run();
        return json({ ok: true });
      }
    }

    return error("Not found", 404);
  },
};
