import type { Env } from "./env";
import { CHUNK_SIZE, TAG_SIZE, planOf } from "../shared/plans";

/**
 * The Vault API.
 *
 * Everything that matters arrives here already encrypted: file contents, names,
 * tags and the keys that open them. The worker's job is to establish who is
 * asking, decide which rows and objects that person may reach, and enforce the
 * limits that have to hold even against a modified client — quota, file size,
 * link expiry, download limits and link passwords.
 */

interface User {
  id: string;
  email: string;
  name: string;
}

type Json = Record<string, unknown>;

// ── Identity ────────────────────────────────────────────────────────────────

/**
 * Verified tokens, briefly. Tokens last about an hour; a minute of cache keeps
 * auth.planary.ch out of the path of every chunk of an upload.
 */
const VERIFIED = new Map<string, { user: User; until: number }>();
const CACHE_MS = 60_000;

async function identify(request: Request, env: Env): Promise<User | null> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return null;

  const hit = VERIFIED.get(token);
  if (hit && hit.until > Date.now()) return hit.user;

  try {
    const res = await fetch(`${env.AUTH_API_URL || "https://auth.planary.ch"}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const { user } = (await res.json()) as { user?: { id: string; email?: string; name?: string } };
    if (!user?.id) return null;
    const email = (user.email ?? "").toLowerCase();
    const found = { id: user.id, email, name: cleanName(user.name || email.split("@")[0]) };
    if (VERIFIED.size > 500) VERIFIED.clear();
    VERIFIED.set(token, { user: found, until: Date.now() + CACHE_MS });
    return found;
  } catch {
    // Auth unreachable: nobody is let in on trust.
    return null;
  }
}

function cleanName(raw: unknown): string {
  return (
    String(raw ?? "")
      .replace(/[<>]/g, "")
      .trim()
      .slice(0, 48) || "Planary user"
  );
}

function describeAgent(ua: string): string {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "another system";
  return `${browser} on ${os}`;
}

/**
 * Every browser that opens the vault gets a device row, which is what Settings
 * lists as active sessions. Signing a device out marks the row; its next
 * request is refused and the app sends it back through auth.planary.ch.
 */
async function touchDevice(request: Request, env: Env, user: User): Promise<boolean> {
  const id = request.headers.get("X-Vault-Device") ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(id)) return true;
  const now = Date.now();
  const row = await env.DB.prepare("SELECT user_id, last_seen, revoked_at FROM devices WHERE id = ?")
    .bind(id)
    .first<{ user_id: string; last_seen: number; revoked_at: number | null }>();
  if (row && (row.revoked_at || row.user_id !== user.id)) return false;
  if (row && now - row.last_seen < 60_000) return true;

  const cf = (request as Request & { cf?: { city?: string; country?: string } }).cf;
  const place = [cf?.city, cf?.country].filter(Boolean).join(", ") || null;
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, agent, place, created_at, last_seen) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen, place = COALESCE(excluded.place, place), agent = excluded.agent`,
  )
    .bind(id, user.id, describeAgent(request.headers.get("User-Agent") ?? ""), place, now, now)
    .run();
  return true;
}

// ── Responses ───────────────────────────────────────────────────────────────

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const ok = allowed.length === 0 || allowed.includes(origin) || /^http:\/\/localhost:\d+$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok && origin ? origin : (allowed[0] ?? "*"),
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Vault-Device",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Length",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function body<T = Json>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
}

function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Ciphertext fields are base64 strings with a sane upper bound. */
function blob(value: unknown, field: string, max = 64 * 1024): string {
  if (typeof value !== "string" || !value || value.length > max || !/^[A-Za-z0-9+/_=-]+$/.test(value)) {
    throw new HttpError(400, `invalid ${field}`);
  }
  return value;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(value)) throw new HttpError(400, `invalid ${field}`);
  return value;
}

/** Bytes a file of `plain` bytes takes once encrypted in chunks. */
function cipherSize(plain: number): number {
  const chunks = Math.max(1, Math.ceil(plain / CHUNK_SIZE));
  return plain + chunks * TAG_SIZE;
}

// ── Access ──────────────────────────────────────────────────────────────────

interface NodeRow {
  id: string;
  owner_id: string;
  parent_id: string | null;
  kind: "file" | "folder";
  enc_meta: string;
  wrapped_key: string;
  /** The node key wrapped by its parent folder's key; how shared folders reach their contents. */
  parent_key: string | null;
  version: number;
  created_at: number;
  updated_at: number;
  trashed_at: number | null;
}

type Access = { node: NodeRow; role: "owner" | "edit" | "view" };

async function access(env: Env, user: User, nodeId: string): Promise<Access> {
  const node = await env.DB.prepare("SELECT * FROM nodes WHERE id = ?").bind(nodeId).first<NodeRow>();
  if (!node) throw new HttpError(404, "not found");
  if (node.owner_id === user.id) return { node, role: "owner" };
  // Shared directly or through a folder above it: walk up until something is in the trash.
  // Any edit share on the way wins, the same rule the file list uses.
  const chain = await env.DB.prepare(
    `WITH RECURSIVE up(id, parent_id, trashed_at, depth) AS (
       SELECT id, parent_id, trashed_at, 0 FROM nodes WHERE id = ?
       UNION ALL
       SELECT n.id, n.parent_id, n.trashed_at, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id WHERE up.depth < ?
     )
     SELECT up.trashed_at, s.role FROM up LEFT JOIN shares s ON s.node_id = up.id AND s.recipient_id = ? ORDER BY up.depth`,
  )
    .bind(nodeId, MAX_DEPTH, user.id)
    .all<{ trashed_at: number | null; role: "view" | "edit" | null }>();
  let role: "view" | "edit" | null = null;
  for (const row of chain.results) {
    if (row.trashed_at) break;
    if (row.role) role = role === "edit" ? "edit" : row.role;
  }
  if (!role) throw new HttpError(404, "not found");
  return { node, role };
}

/** Folder trees deeper than this are cut off; it also stops a cycle from running forever. */
const MAX_DEPTH = 64;

/** Whether `folderId` is `nodeId` or somewhere inside it. */
async function isInside(env: Env, folderId: string, nodeId: string): Promise<boolean> {
  const hit = await env.DB.prepare(
    `WITH RECURSIVE up(id, parent_id, depth) AS (
       SELECT id, parent_id, 0 FROM nodes WHERE id = ?
       UNION ALL
       SELECT n.id, n.parent_id, up.depth + 1 FROM nodes n JOIN up ON n.id = up.parent_id WHERE up.depth < ?
     )
     SELECT 1 FROM up WHERE id = ?`,
  )
    .bind(folderId, MAX_DEPTH, nodeId)
    .first();
  return !!hit;
}

function requireOwner(a: Access) {
  if (a.role !== "owner") throw new HttpError(403, "only the owner can do that");
}

function requireEdit(a: Access) {
  if (a.role === "view") throw new HttpError(403, "view only");
}

async function vaultOf(env: Env, userId: string) {
  return env.DB.prepare("SELECT * FROM vaults WHERE user_id = ?").bind(userId).first<{
    user_id: string;
    email: string;
    name: string;
    kdf: string;
    wrapped_master_pw: string;
    wrapped_master_rk: string;
    public_key: string;
    wrapped_private_key: string;
    auto_lock_minutes: number;
    plan: string;
    created_at: number;
  }>();
}

async function requireVault(env: Env, user: User) {
  const vault = await vaultOf(env, user.id);
  if (!vault) throw new HttpError(409, "no vault yet");
  return vault;
}

async function usage(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    // Restored versions share an object with an older one; count each object once.
    `SELECT COALESCE(SUM(size), 0) AS used FROM
       (SELECT DISTINCT v.blob_key, v.size FROM versions v JOIN nodes n ON n.id = v.node_id WHERE n.owner_id = ?)`,
  )
    .bind(userId)
    .first<{ used: number }>();
  return row?.used ?? 0;
}

async function log(env: Env, nodeId: string, actor: User | null, action: string, detail: Json | null = null) {
  await env.DB.prepare("INSERT INTO activity (node_id, actor_id, actor_name, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(nodeId, actor?.id ?? null, actor?.name ?? null, action, detail ? JSON.stringify(detail) : null, Date.now())
    .run();
}

// ── Link passwords ──────────────────────────────────────────────────────────

const PBKDF2_ROUNDS = 100_000;

async function hashPassword(password: string, saltB64?: string): Promise<string> {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ROUNDS }, key, 256);
  const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
  return `${b64(salt)}:${b64(new Uint8Array(bits))}`;
}

async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":");
  const actual = (await hashPassword(password, salt)).split(":")[1];
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function deleteNodeTree(env: Env, nodeId: string) {
  const children = await env.DB.prepare("SELECT id FROM nodes WHERE parent_id = ?").bind(nodeId).all<{ id: string }>();
  for (const child of children.results) await deleteNodeTree(env, child.id);
  const blobs = await env.DB.prepare("SELECT blob_key FROM versions WHERE node_id = ?").bind(nodeId).all<{ blob_key: string }>();
  // Restored versions point at an older version's object, so delete each object once.
  const keys = [...new Set(blobs.results.map((b) => b.blob_key))];
  if (keys.length) await env.BLOBS.delete(keys);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM versions WHERE node_id = ?").bind(nodeId),
    env.DB.prepare("DELETE FROM shares WHERE node_id = ?").bind(nodeId),
    env.DB.prepare("DELETE FROM links WHERE node_id = ?").bind(nodeId),
    env.DB.prepare("DELETE FROM activity WHERE node_id = ?").bind(nodeId),
    env.DB.prepare("DELETE FROM nodes WHERE id = ?").bind(nodeId),
  ]);
}

function serializeNode(n: NodeRow & { size?: number | null; total?: number | null }) {
  return {
    id: n.id,
    parentId: n.parent_id,
    kind: n.kind,
    encMeta: n.enc_meta,
    wrappedKey: n.wrapped_key,
    parentKey: n.parent_key,
    version: n.version,
    size: n.size ?? 0,
    totalSize: n.total ?? 0,
    createdAt: n.created_at,
    updatedAt: n.updated_at,
    trashedAt: n.trashed_at,
  };
}

async function listNodes(env: Env, user: User) {
  const vault = await requireVault(env, user);
  const own = await env.DB.prepare(
    `SELECT n.*,
       (SELECT size FROM versions WHERE node_id = n.id AND n = n.version) AS size,
       (SELECT COALESCE(SUM(size), 0) FROM (SELECT DISTINCT blob_key, size FROM versions WHERE node_id = n.id)) AS total
     FROM nodes n WHERE n.owner_id = ?`,
  )
    .bind(user.id)
    .all<NodeRow & { size: number | null; total: number }>();

  const sharesOut = await env.DB.prepare(
    `SELECT s.node_id, v.name FROM shares s JOIN vaults v ON v.user_id = s.recipient_id WHERE s.owner_id = ? ORDER BY s.created_at`,
  )
    .bind(user.id)
    .all<{ node_id: string; name: string }>();
  const sharedWith = new Map<string, string[]>();
  for (const s of sharesOut.results) sharedWith.set(s.node_id, [...(sharedWith.get(s.node_id) ?? []), s.name]);

  // Everything shared with this person: the shared nodes themselves (depth 0, key sealed to them)
  // and, below shared folders, everything that isn't in the trash (key wrapped by the parent).
  const incoming = await env.DB.prepare(
    `WITH RECURSIVE tree(id, role, depth) AS (
       SELECT s.node_id, s.role, 0 FROM shares s JOIN nodes n ON n.id = s.node_id WHERE s.recipient_id = ? AND n.trashed_at IS NULL
       UNION ALL
       SELECT n.id, tree.role, tree.depth + 1 FROM nodes n JOIN tree ON n.parent_id = tree.id WHERE n.trashed_at IS NULL AND tree.depth < ?
     )
     SELECT n.*, tree.role, tree.depth, s.sealed_key, o.name AS owner_name,
       (SELECT size FROM versions WHERE node_id = n.id AND n = n.version) AS size
     FROM tree JOIN nodes n ON n.id = tree.id JOIN vaults o ON o.user_id = n.owner_id
     LEFT JOIN shares s ON tree.depth = 0 AND s.node_id = n.id AND s.recipient_id = ?`,
  )
    .bind(user.id, MAX_DEPTH, user.id)
    .all<NodeRow & { role: "view" | "edit"; depth: number; sealed_key: string | null; owner_name: string; size: number | null }>();

  // A node can turn up more than once (shared itself and inside a shared folder, or nested shares).
  type Incoming = (typeof incoming.results)[number];
  const seen = new Map<string, { row: Incoming; inTree: boolean; sealedKey: string | null; role: "view" | "edit" }>();
  for (const row of incoming.results) {
    const at = seen.get(row.id) ?? { row, inTree: false, sealedKey: null, role: row.role };
    if (row.depth > 0) at.inTree = true;
    if (row.sealed_key) at.sealedKey = row.sealed_key;
    if (row.role === "edit") at.role = "edit";
    seen.set(row.id, at);
  }

  const plan = planOf(vault.plan);
  return {
    nodes: own.results.map((n) => ({ ...serializeNode(n), sharedWith: sharedWith.get(n.id) ?? [] })),
    shared: [...seen.values()].map(({ row, inTree, sealedKey, role }) => ({
      ...serializeNode(row),
      // Top-level shares show up loose under "Shared with me"; the rest keep their folder.
      parentId: inTree ? row.parent_id : null,
      wrappedKey: null,
      parentKey: inTree ? row.parent_key : null,
      sealedKey,
      role,
      ownerName: row.owner_name,
      sharedWith: [],
    })),
    usage: { used: await usage(env, user.id), plan: plan.id },
  };
}

async function route(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;
  const at = (...pattern: string[]) =>
    parts.length === pattern.length && pattern.every((p, i) => p.startsWith(":") || p === parts[i]);

  if (at("health")) return json({ status: "ok" });

  // Public link pages: no account needed, the key lives in the URL fragment.
  if (parts[0] === "public" && at("public", "links", ":id")) {
    const link = await env.DB.prepare(
      `SELECT l.*, n.enc_meta, n.version, n.trashed_at,
         (SELECT size FROM versions WHERE node_id = n.id AND n = n.version) AS size
       FROM links l JOIN nodes n ON n.id = l.node_id WHERE l.id = ?`,
    )
      .bind(parts[2])
      .first<{
        expires_at: number | null;
        download_limit: number | null;
        downloads: number;
        revoked_at: number | null;
        password_hash: string | null;
        enc_meta: string;
        trashed_at: number | null;
        size: number;
      }>();
    if (!link || link.revoked_at || link.trashed_at) return json({ status: "gone" });
    if (link.expires_at && link.expires_at < Date.now()) return json({ status: "expired" });
    if (link.download_limit !== null && link.downloads >= link.download_limit) return json({ status: "used" });
    return json({ status: "ok", needsPassword: !!link.password_hash, encMeta: link.enc_meta, size: link.size });
  }

  if (parts[0] === "public" && at("public", "links", ":id", "download") && method === "POST") {
    const { password } = await body<{ password?: string }>(request);
    const link = await env.DB.prepare(
      `SELECT l.*, n.version, n.trashed_at, v.blob_key, v.nonce
       FROM links l JOIN nodes n ON n.id = l.node_id JOIN versions v ON v.node_id = n.id AND v.n = n.version
       WHERE l.id = ?`,
    )
      .bind(parts[2])
      .first<{
        id: string;
        node_id: string;
        expires_at: number | null;
        download_limit: number | null;
        downloads: number;
        revoked_at: number | null;
        password_hash: string | null;
        trashed_at: number | null;
        blob_key: string;
        nonce: string;
      }>();
    if (!link || link.revoked_at || link.trashed_at) throw new HttpError(410, "gone");
    if (link.expires_at && link.expires_at < Date.now()) throw new HttpError(410, "expired");
    if (link.password_hash && !(await checkPassword(String(password ?? ""), link.password_hash))) {
      throw new HttpError(403, "wrong password");
    }
    // Count the download before handing out bytes, atomically against the limit.
    const counted = await env.DB.prepare(
      "UPDATE links SET downloads = downloads + 1 WHERE id = ? AND (download_limit IS NULL OR downloads < download_limit)",
    )
      .bind(link.id)
      .run();
    if (!counted.meta.changes) throw new HttpError(410, "used");
    const object = await env.BLOBS.get(link.blob_key);
    if (!object) throw new HttpError(404, "not found");
    ctx.waitUntil(log(env, link.node_id, null, "link_downloaded"));
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "X-Vault-Nonce": link.nonce,
        "Access-Control-Expose-Headers": "Content-Length, X-Vault-Nonce",
      },
    });
  }

  // Everything below needs a Planary account.
  const user = await identify(request, env);
  if (!user) throw new HttpError(401, "not authenticated");
  if (!(await touchDevice(request, env, user))) return json({ error: "device signed out" }, 401);

  // ── The vault itself
  if (at("vault") && method === "GET") {
    const vault = await vaultOf(env, user.id);
    if (!vault) return json({ exists: false, user });
    if (vault.name !== user.name || vault.email !== user.email) {
      ctx.waitUntil(env.DB.prepare("UPDATE vaults SET name = ?, email = ? WHERE user_id = ?").bind(user.name, user.email, user.id).run());
    }
    return json({
      exists: true,
      user,
      vault: {
        kdf: JSON.parse(vault.kdf),
        wrappedMasterPw: vault.wrapped_master_pw,
        wrappedMasterRk: vault.wrapped_master_rk,
        publicKey: vault.public_key,
        wrappedPrivateKey: vault.wrapped_private_key,
        autoLockMinutes: vault.auto_lock_minutes,
        plan: vault.plan,
        createdAt: vault.created_at,
      },
    });
  }

  if (at("vault") && method === "POST") {
    const b = await body(request);
    if (await vaultOf(env, user.id)) throw new HttpError(409, "vault exists");
    await env.DB.prepare(
      `INSERT INTO vaults (user_id, email, name, kdf, wrapped_master_pw, wrapped_master_rk, public_key, wrapped_private_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        user.id,
        user.email,
        user.name,
        JSON.stringify(b.kdf ?? {}),
        blob(b.wrappedMasterPw, "wrappedMasterPw"),
        blob(b.wrappedMasterRk, "wrappedMasterRk"),
        blob(b.publicKey, "publicKey"),
        blob(b.wrappedPrivateKey, "wrappedPrivateKey"),
        Date.now(),
      )
      .run();
    return json({ ok: true }, 201);
  }

  if (at("vault", "keys") && method === "PATCH") {
    await requireVault(env, user);
    const b = await body(request);
    if (b.wrappedMasterPw) {
      await env.DB.prepare("UPDATE vaults SET kdf = ?, wrapped_master_pw = ? WHERE user_id = ?")
        .bind(JSON.stringify(b.kdf ?? {}), blob(b.wrappedMasterPw, "wrappedMasterPw"), user.id)
        .run();
    }
    if (b.wrappedMasterRk) {
      await env.DB.prepare("UPDATE vaults SET wrapped_master_rk = ? WHERE user_id = ?")
        .bind(blob(b.wrappedMasterRk, "wrappedMasterRk"), user.id)
        .run();
    }
    return json({ ok: true });
  }

  if (at("vault", "settings") && method === "PATCH") {
    await requireVault(env, user);
    const { autoLockMinutes } = await body<{ autoLockMinutes?: number }>(request);
    if (![5, 15, 60].includes(Number(autoLockMinutes))) throw new HttpError(400, "invalid autoLockMinutes");
    await env.DB.prepare("UPDATE vaults SET auto_lock_minutes = ? WHERE user_id = ?").bind(Number(autoLockMinutes), user.id).run();
    return json({ ok: true });
  }

  if (at("vault") && method === "DELETE") {
    await requireVault(env, user);
    const roots = await env.DB.prepare("SELECT id FROM nodes WHERE owner_id = ?").bind(user.id).all<{ id: string }>();
    for (const n of roots.results) {
      // A parent may already have taken this node with it.
      const still = await env.DB.prepare("SELECT 1 FROM nodes WHERE id = ?").bind(n.id).first();
      if (still) await deleteNodeTree(env, n.id);
    }
    await env.DB.batch([
      env.DB.prepare("DELETE FROM shares WHERE recipient_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM uploads WHERE user_id = ?").bind(user.id),
      env.DB.prepare("DELETE FROM vaults WHERE user_id = ?").bind(user.id),
    ]);
    return json({ ok: true });
  }

  // ── Files and folders
  if (at("nodes") && method === "GET") return json(await listNodes(env, user));

  if (at("folders") && method === "POST") {
    await requireVault(env, user);
    const b = await body(request);
    const parentId = optionalId(b.parentId, "parentId");
    if (parentId) requireOwner(await access(env, user, parentId));
    const id = newId();
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO nodes (id, owner_id, parent_id, kind, enc_meta, wrapped_key, parent_key, created_at, updated_at) VALUES (?, ?, ?, 'folder', ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        user.id,
        parentId,
        blob(b.encMeta, "encMeta"),
        blob(b.wrappedKey, "wrappedKey"),
        parentId ? blob(b.parentKey, "parentKey") : null,
        now,
        now,
      )
      .run();
    return json({ id }, 201);
  }

  if (at("nodes", ":id") && method === "PATCH") {
    const a = await access(env, user, parts[1]);
    const b = await body(request);
    const sets: string[] = [];
    const values: unknown[] = [];
    if (b.encMeta !== undefined) {
      requireEdit(a);
      sets.push("enc_meta = ?");
      values.push(blob(b.encMeta, "encMeta"));
    }
    if (b.parentId !== undefined) {
      requireOwner(a);
      const parentId = optionalId(b.parentId, "parentId");
      if (parentId) {
        const parent = await access(env, user, parentId);
        requireOwner(parent);
        if (parent.node.kind !== "folder" || (await isInside(env, parentId, a.node.id))) throw new HttpError(400, "invalid parentId");
      }
      sets.push("parent_id = ?", "parent_key = ?");
      values.push(parentId, parentId ? blob(b.parentKey, "parentKey") : null);
    }
    if (b.trashed !== undefined) {
      requireOwner(a);
      sets.push("trashed_at = ?");
      values.push(b.trashed ? Date.now() : null);
    }
    if (!sets.length) return json({ ok: true });
    sets.push("updated_at = ?");
    values.push(Date.now());
    await env.DB.prepare(`UPDATE nodes SET ${sets.join(", ")} WHERE id = ?`)
      .bind(...values, a.node.id)
      .run();
    return json({ ok: true });
  }

  // Parent-wrapped keys for nodes created before folder sharing; the owner's browser sends them after unlock.
  if (at("nodes", "parent-keys") && method === "POST") {
    const { keys } = await body<{ keys?: { id?: unknown; parentKey?: unknown }[] }>(request);
    if (!Array.isArray(keys) || keys.length > 500) throw new HttpError(400, "invalid keys");
    const statements = keys.map((k) =>
      env.DB.prepare("UPDATE nodes SET parent_key = ? WHERE id = ? AND owner_id = ? AND parent_id IS NOT NULL AND parent_key IS NULL").bind(
        blob(k.parentKey, "parentKey"),
        optionalId(k.id, "id"),
        user.id,
      ),
    );
    if (statements.length) await env.DB.batch(statements);
    return json({ ok: true });
  }

  if (at("nodes", ":id") && method === "DELETE") {
    const a = await access(env, user, parts[1]);
    requireOwner(a);
    await deleteNodeTree(env, a.node.id);
    return json({ ok: true });
  }

  // ── Uploads: R2 multipart, one encrypted chunk per part
  if (at("uploads") && method === "POST") {
    const vault = await requireVault(env, user);
    const b = await body(request);
    const plain = Number(b.size);
    if (!Number.isFinite(plain) || plain < 0) throw new HttpError(400, "invalid size");
    const size = cipherSize(plain);
    const plan = planOf(vault.plan);
    if (size > plan.maxFile + TAG_SIZE * Math.ceil(plan.maxFile / CHUNK_SIZE)) throw new HttpError(413, "file too large for your plan");
    if ((await usage(env, user.id)) + size > plan.quota) throw new HttpError(413, "vault is full");

    const existing = optionalId(b.nodeId, "nodeId");
    let nodeId: string;
    let parentId: string | null = null;
    let wrappedKey: string | null = null;
    let parentKey: string | null = null;
    if (existing) {
      const a = await access(env, user, existing);
      requireEdit(a);
      if (a.node.kind !== "file") throw new HttpError(400, "not a file");
      nodeId = existing;
    } else {
      parentId = optionalId(b.parentId, "parentId");
      if (parentId) requireOwner(await access(env, user, parentId));
      nodeId = newId();
      wrappedKey = blob(b.wrappedKey, "wrappedKey");
      if (parentId) parentKey = blob(b.parentKey, "parentKey");
    }
    const id = newId();
    const blobKey = `${nodeId}/${newId()}`;
    const multipart = await env.BLOBS.createMultipartUpload(blobKey);
    await env.DB.prepare(
      `INSERT INTO uploads (id, user_id, node_id, is_new, parent_id, enc_meta, wrapped_key, parent_key, nonce, size, blob_key, r2_upload_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        user.id,
        nodeId,
        existing ? 0 : 1,
        parentId,
        blob(b.encMeta, "encMeta"),
        wrappedKey,
        parentKey,
        blob(b.nonce, "nonce", 64),
        size,
        blobKey,
        multipart.uploadId,
        Date.now(),
      )
      .run();
    return json({ uploadId: id, nodeId, parts: Math.max(1, Math.ceil(plain / CHUNK_SIZE)) }, 201);
  }

  if (parts[0] === "uploads") {
    const upload = await env.DB.prepare("SELECT * FROM uploads WHERE id = ? AND user_id = ?").bind(parts[1] ?? "", user.id).first<{
      id: string;
      node_id: string;
      is_new: number;
      parent_id: string | null;
      enc_meta: string;
      wrapped_key: string | null;
      parent_key: string | null;
      nonce: string;
      size: number;
      blob_key: string;
      r2_upload_id: string;
    }>();
    if (!upload) throw new HttpError(404, "upload not found");
    const multipart = env.BLOBS.resumeMultipartUpload(upload.blob_key, upload.r2_upload_id);

    if (at("uploads", ":id", "parts", ":n") && method === "PUT") {
      const n = Number(parts[3]);
      const length = Number(request.headers.get("Content-Length"));
      if (!Number.isInteger(n) || n < 1 || n > 10_000) throw new HttpError(400, "invalid part");
      if (!request.body || !(length > 0) || length > CHUNK_SIZE + TAG_SIZE) throw new HttpError(400, "invalid part size");
      const part = await multipart.uploadPart(n, request.body);
      return json({ n: part.partNumber, etag: part.etag });
    }

    if (at("uploads", ":id", "complete") && method === "POST") {
      const b = await body<{ parts?: { n: number; etag: string }[] }>(request);
      const done = await multipart.complete((b.parts ?? []).map((p) => ({ partNumber: Number(p.n), etag: String(p.etag) })));
      if (done.size !== upload.size) {
        await env.BLOBS.delete(upload.blob_key);
        await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(upload.id).run();
        throw new HttpError(400, "size mismatch");
      }
      const now = Date.now();
      const statements = [];
      let version = 1;
      if (upload.is_new) {
        statements.push(
          env.DB.prepare(
            "INSERT INTO nodes (id, owner_id, parent_id, kind, enc_meta, wrapped_key, parent_key, version, created_at, updated_at) VALUES (?, ?, ?, 'file', ?, ?, ?, 1, ?, ?)",
          ).bind(upload.node_id, user.id, upload.parent_id, upload.enc_meta, upload.wrapped_key, upload.parent_key, now, now),
        );
      } else {
        const node = await env.DB.prepare("SELECT version FROM nodes WHERE id = ?").bind(upload.node_id).first<{ version: number }>();
        version = (node?.version ?? 0) + 1;
        statements.push(
          env.DB.prepare("UPDATE nodes SET version = ?, enc_meta = ?, updated_at = ? WHERE id = ?").bind(
            version,
            upload.enc_meta,
            now,
            upload.node_id,
          ),
        );
      }
      statements.push(
        env.DB.prepare("INSERT INTO versions (node_id, n, blob_key, nonce, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
          upload.node_id,
          version,
          upload.blob_key,
          upload.nonce,
          upload.size,
          user.id,
          now,
        ),
        env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(upload.id),
      );
      await env.DB.batch(statements);
      await log(env, upload.node_id, user, "uploaded", { version });
      return json({ nodeId: upload.node_id, version });
    }

    if (at("uploads", ":id") && method === "DELETE") {
      await multipart.abort().catch(() => undefined);
      await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(upload.id).run();
      return json({ ok: true });
    }
  }

  // ── File contents, versions and activity
  if (at("nodes", ":id", "content") && method === "GET") {
    const a = await access(env, user, parts[1]);
    const n = Number(url.searchParams.get("v") ?? a.node.version);
    const version = await env.DB.prepare("SELECT blob_key, nonce FROM versions WHERE node_id = ? AND n = ?")
      .bind(a.node.id, n)
      .first<{ blob_key: string; nonce: string }>();
    if (!version) throw new HttpError(404, "no such version");
    const object = await env.BLOBS.get(version.blob_key);
    if (!object) throw new HttpError(404, "not found");
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(object.size),
        "X-Vault-Nonce": version.nonce,
        "Access-Control-Expose-Headers": "Content-Length, X-Vault-Nonce",
        "Cache-Control": "no-store",
      },
    });
  }

  if (at("nodes", ":id", "versions") && method === "GET") {
    const a = await access(env, user, parts[1]);
    const rows = await env.DB.prepare(
      `SELECT v.n, v.size, v.created_at, v.created_by, COALESCE(u.name, 'Someone') AS by_name
       FROM versions v LEFT JOIN vaults u ON u.user_id = v.created_by WHERE v.node_id = ? ORDER BY v.n DESC`,
    )
      .bind(a.node.id)
      .all<{ n: number; size: number; created_at: number; created_by: string; by_name: string }>();
    return json({
      current: a.node.version,
      versions: rows.results.map((v) => ({ n: v.n, size: v.size, createdAt: v.created_at, by: v.created_by === user.id ? null : v.by_name })),
    });
  }

  if (at("nodes", ":id", "versions", ":n", "restore") && method === "POST") {
    const a = await access(env, user, parts[1]);
    requireEdit(a);
    const old = await env.DB.prepare("SELECT blob_key, nonce, size FROM versions WHERE node_id = ? AND n = ?")
      .bind(a.node.id, Number(parts[3]))
      .first<{ blob_key: string; nonce: string; size: number }>();
    if (!old) throw new HttpError(404, "no such version");
    const { encMeta } = await body<{ encMeta?: string }>(request);
    const version = a.node.version + 1;
    const now = Date.now();
    // The restored version reuses the old object: same bytes, same key, no upload.
    await env.DB.batch([
      env.DB.prepare("INSERT INTO versions (node_id, n, blob_key, nonce, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
        a.node.id,
        version,
        old.blob_key,
        old.nonce,
        old.size,
        user.id,
        now,
      ),
      env.DB.prepare("UPDATE nodes SET version = ?, enc_meta = COALESCE(?, enc_meta), updated_at = ? WHERE id = ?").bind(
        version,
        encMeta ? blob(encMeta, "encMeta") : null,
        now,
        a.node.id,
      ),
    ]);
    await log(env, a.node.id, user, "restored", { version: Number(parts[3]) });
    return json({ version });
  }

  if (at("nodes", ":id", "activity") && method === "GET") {
    const a = await access(env, user, parts[1]);
    const rows = await env.DB.prepare("SELECT * FROM activity WHERE node_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(a.node.id)
      .all<{ id: number; actor_id: string | null; actor_name: string | null; action: string; detail: string | null; created_at: number }>();
    return json({
      activity: rows.results.map((r) => ({
        id: r.id,
        actor: r.actor_id === user.id ? null : r.actor_name,
        isLink: r.actor_id === null,
        action: r.action,
        detail: r.detail ? JSON.parse(r.detail) : null,
        createdAt: r.created_at,
      })),
    });
  }

  if (at("nodes", ":id", "viewed") && method === "POST") {
    const a = await access(env, user, parts[1]);
    // Owners opening their own files would drown the log; views by people it's shared with are what matter.
    if (a.role !== "owner") {
      const recent = await env.DB.prepare(
        "SELECT 1 FROM activity WHERE node_id = ? AND actor_id = ? AND action = 'viewed' AND created_at > ?",
      )
        .bind(a.node.id, user.id, Date.now() - 60 * 60_000)
        .first();
      if (!recent) await log(env, a.node.id, user, "viewed");
    }
    return json({ ok: true });
  }

  // ── Sharing
  if (at("users", "lookup") && method === "GET") {
    const email = (url.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!email.includes("@")) throw new HttpError(400, "invalid email");
    const found = await env.DB.prepare("SELECT user_id, name, email, public_key FROM vaults WHERE email = ?")
      .bind(email)
      .first<{ user_id: string; name: string; email: string; public_key: string }>();
    if (!found || found.user_id === user.id) throw new HttpError(404, "no vault for that email");
    return json({ id: found.user_id, name: found.name, email: found.email, publicKey: found.public_key });
  }

  if (at("nodes", ":id", "shares") && method === "GET") {
    const a = await access(env, user, parts[1]);
    requireOwner(a);
    const people = await env.DB.prepare(
      "SELECT s.id, s.role, s.created_at, v.name, v.email FROM shares s JOIN vaults v ON v.user_id = s.recipient_id WHERE s.node_id = ? ORDER BY s.created_at",
    )
      .bind(a.node.id)
      .all<{ id: string; role: string; created_at: number; name: string; email: string }>();
    const links = await env.DB.prepare("SELECT * FROM links WHERE node_id = ? AND revoked_at IS NULL ORDER BY created_at DESC")
      .bind(a.node.id)
      .all<{ id: string; password_hash: string | null; expires_at: number | null; download_limit: number | null; downloads: number; created_at: number }>();
    return json({
      people: people.results.map((p) => ({ id: p.id, role: p.role, name: p.name, email: p.email, createdAt: p.created_at })),
      links: links.results.map((l) => ({
        id: l.id,
        hasPassword: !!l.password_hash,
        expiresAt: l.expires_at,
        downloadLimit: l.download_limit,
        downloads: l.downloads,
        createdAt: l.created_at,
      })),
    });
  }

  if (at("nodes", ":id", "shares") && method === "POST") {
    const a = await access(env, user, parts[1]);
    requireOwner(a);
    const b = await body(request);
    const recipient = await vaultOf(env, String(b.recipientId ?? ""));
    if (!recipient || recipient.user_id === user.id) throw new HttpError(404, "no such person");
    const role = b.role === "edit" ? "edit" : "view";
    await env.DB.prepare(
      `INSERT INTO shares (id, node_id, owner_id, recipient_id, role, sealed_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (node_id, recipient_id) DO UPDATE SET role = excluded.role, sealed_key = excluded.sealed_key`,
    )
      .bind(newId(), a.node.id, user.id, recipient.user_id, role, blob(b.sealedKey, "sealedKey"), Date.now())
      .run();
    await log(env, a.node.id, user, "shared", { name: recipient.name, role });
    return json({ ok: true }, 201);
  }

  if (at("shares", ":id") && method === "DELETE") {
    const share = await env.DB.prepare(
      "SELECT s.*, v.name FROM shares s JOIN vaults v ON v.user_id = s.recipient_id WHERE s.id = ? AND s.owner_id = ?",
    )
      .bind(parts[1], user.id)
      .first<{ id: string; node_id: string; name: string }>();
    if (!share) throw new HttpError(404, "not found");
    await env.DB.prepare("DELETE FROM shares WHERE id = ?").bind(share.id).run();
    await log(env, share.node_id, user, "unshared", { name: share.name });
    return json({ ok: true });
  }

  if (at("nodes", ":id", "links") && method === "POST") {
    const a = await access(env, user, parts[1]);
    requireOwner(a);
    if (a.node.kind !== "file") throw new HttpError(400, "only files can be shared");
    const plan = planOf((await requireVault(env, user)).plan);
    const b = await body<{ password?: string; expiresAt?: number | null; downloadLimit?: number | null }>(request);

    let expiresAt = b.expiresAt ? Number(b.expiresAt) : null;
    if (expiresAt !== null && (!Number.isFinite(expiresAt) || expiresAt < Date.now())) throw new HttpError(400, "invalid expiry");
    if (plan.linkDays !== null) {
      const latest = Date.now() + plan.linkDays * 86_400_000;
      if (expiresAt === null || expiresAt > latest) expiresAt = latest;
    }
    let limit = b.downloadLimit ? Math.floor(Number(b.downloadLimit)) : null;
    if (limit !== null && !(limit > 0)) throw new HttpError(400, "invalid download limit");
    if (plan.linkDownloads !== null && (limit === null || limit > plan.linkDownloads)) limit = plan.linkDownloads;

    const id = newId();
    const passwordHash = b.password ? await hashPassword(String(b.password)) : null;
    await env.DB.prepare(
      "INSERT INTO links (id, node_id, owner_id, password_hash, expires_at, download_limit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, a.node.id, user.id, passwordHash, expiresAt, limit, Date.now())
      .run();
    await log(env, a.node.id, user, "link_created", { expiresAt });
    return json({ id, expiresAt, downloadLimit: limit }, 201);
  }

  if (at("links", ":id") && method === "DELETE") {
    const link = await env.DB.prepare("SELECT id, node_id, expires_at FROM links WHERE id = ? AND owner_id = ?")
      .bind(parts[1], user.id)
      .first<{ id: string; node_id: string; expires_at: number | null }>();
    if (!link) throw new HttpError(404, "not found");
    await env.DB.prepare("UPDATE links SET revoked_at = ? WHERE id = ?").bind(Date.now(), link.id).run();
    if (!link.expires_at || link.expires_at > Date.now()) await log(env, link.node_id, user, "link_revoked");
    return json({ ok: true });
  }

  // ── Devices
  if (at("sessions") && method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM devices WHERE user_id = ? AND revoked_at IS NULL ORDER BY last_seen DESC LIMIT 20")
      .bind(user.id)
      .all<{ id: string; agent: string; place: string | null; last_seen: number }>();
    return json({
      sessions: rows.results.map((d) => ({ id: d.id, agent: d.agent, place: d.place, lastSeen: d.last_seen })),
    });
  }

  if (at("sessions", ":id") && method === "DELETE") {
    await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND user_id = ?").bind(Date.now(), parts[1], user.id).run();
    return json({ ok: true });
  }

  if (at("sessions") && method === "DELETE") {
    const self = request.headers.get("X-Vault-Device") ?? "";
    await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL")
      .bind(Date.now(), user.id, self)
      .run();
    return json({ ok: true });
  }

  throw new HttpError(404, "no such route");
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    let response: Response;
    try {
      response = await route(request, env, ctx);
    } catch (error) {
      if (error instanceof HttpError) response = json({ error: error.message }, error.status);
      else {
        console.error(error);
        response = json({ error: "something went wrong" }, 500);
      }
    }
    const headers = new Headers(response.headers);
    for (const [k, v] of Object.entries(cors)) {
      // Download responses list their own exposed headers.
      if (k === "Access-Control-Expose-Headers" && headers.has(k)) continue;
      headers.set(k, v);
    }
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
