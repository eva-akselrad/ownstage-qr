export interface Env {
  LINKS: KVNamespace;
  ASSETS: Fetcher;
  PUBLIC_BASE_URL: string;
}

interface LinkRecord {
  url: string;
  tokenHash: string;
  createdAt: string;
  updatedAt: string;
}

const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function error(message: string, status: number): Response {
  return json({ error: message }, status);
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
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
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

async function readLink(env: Env, id: string): Promise<LinkRecord | null> {
  const raw = await env.LINKS.get(id);
  if (!raw) return null;
  return JSON.parse(raw) as LinkRecord;
}

async function verifyToken(record: LinkRecord, token: string): Promise<boolean> {
  const hash = await hashToken(token);
  return hash === record.tokenHash;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const base = env.PUBLIC_BASE_URL.replace(/\/$/, "");

    if (url.pathname.startsWith("/r/")) {
      const id = url.pathname.slice(3).split("/")[0];
      if (!isValidId(id)) return error("Not found", 404);
      const record = await readLink(env, id);
      if (!record) return error("This link does not exist.", 404);
      return Response.redirect(record.url, 302);
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method === "OPTIONS") {
        return new Response(null, {
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
            "access-control-allow-headers": "content-type, authorization",
          },
        });
      }

      const cors = { "access-control-allow-origin": "*" };

      if (url.pathname === "/api/links" && request.method === "POST") {
        let body: { url?: string };
        try {
          body = await request.json();
        } catch {
          return error("Invalid JSON body.", 400);
        }
        const destination = normalizeUrl(body.url ?? "");
        if (!destination) return error("Enter a valid http(s) URL.", 400);

        const id = randomId(8);
        const editToken = randomToken();
        const tokenHash = await hashToken(editToken);
        const now = new Date().toISOString();
        const record: LinkRecord = {
          url: destination,
          tokenHash,
          createdAt: now,
          updatedAt: now,
        };
        await env.LINKS.put(id, JSON.stringify(record));

        return json(
          {
            id,
            destination,
            shortUrl: `${base}/r/${id}`,
            editToken,
            managePath: `/manage/${id}`,
          },
          201,
        );
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
        const record = await readLink(env, id);
        if (!record) return error("Not found", 404);
        if (!(await verifyToken(record, token))) {
          return error("Invalid edit token.", 403);
        }
        return json({ ok: true });
      }

      const match = url.pathname.match(/^\/api\/links\/([^/]+)$/);
      if (match) {
        const id = match[1];
        if (!isValidId(id)) return error("Not found", 404);

        if (request.method === "GET") {
          const record = await readLink(env, id);
          if (!record) return error("Not found", 404);
          return json({
            id,
            destination: record.url,
            shortUrl: `${base}/r/${id}`,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          });
        }

        if (request.method === "PATCH") {
          const auth = request.headers.get("authorization") ?? "";
          const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
          if (!token) return error("Missing edit token.", 401);

          const record = await readLink(env, id);
          if (!record) return error("Not found", 404);
          if (!(await verifyToken(record, token))) {
            return error("Invalid edit token.", 403);
          }

          let body: { url?: string };
          try {
            body = await request.json();
          } catch {
            return error("Invalid JSON body.", 400);
          }
          const destination = normalizeUrl(body.url ?? "");
          if (!destination) return error("Enter a valid http(s) URL.", 400);

          record.url = destination;
          record.updatedAt = new Date().toISOString();
          await env.LINKS.put(id, JSON.stringify(record));

          return json({
            id,
            destination: record.url,
            shortUrl: `${base}/r/${id}`,
            updatedAt: record.updatedAt,
          });
        }
      }

      return error("Not found", 404);
    }

    return env.ASSETS.fetch(request);
  },
};
