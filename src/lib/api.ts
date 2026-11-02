import type { KdfParams } from "./crypto";

export const VAULT_API = process.env.NEXT_PUBLIC_VAULT_API || "https://planary-vault-api.planary.workers.dev";

const DEVICE_KEY = "planary.vault.device";

/** One random id per browser; it's what Settings lists under active sessions. */
export function deviceId(): string {
  try {
    let id = window.localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID().replace(/-/g, "");
      window.localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export function forgetDevice() {
  try {
    window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Nothing stored.
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

let token = "";
let onSignedOut: (() => void) | null = null;

export function configureApi(accessToken: string, signedOut: () => void) {
  token = accessToken;
  onSignedOut = signedOut;
}

function headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  if (token) h.set("Authorization", `Bearer ${token}`);
  const device = deviceId();
  if (device) h.set("X-Vault-Device", device);
  return h;
}

async function fail(res: Response): Promise<never> {
  const { error } = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && onSignedOut) onSignedOut();
  throw new ApiError(res.status, error || `Request failed (${res.status})`);
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${VAULT_API}${path}`, {
    method: init.method ?? "GET",
    headers: headers(init.body !== undefined ? { "Content-Type": "application/json" } : undefined),
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) await fail(res);
  return (await res.json()) as T;
}

/** For binary uploads (one encrypted chunk) and downloads (a ciphertext stream). */
export async function apiRaw(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${VAULT_API}${path}`, { ...init, headers: headers(init.headers), cache: "no-store" });
  if (!res.ok) await fail(res);
  return res;
}

// ── Shapes the API returns ──────────────────────────────────────────────────

export interface VaultRecord {
  kdf: KdfParams;
  wrappedMasterPw: string;
  wrappedMasterRk: string;
  publicKey: string;
  wrappedPrivateKey: string;
  autoLockMinutes: number;
  plan: string;
  /** Where the plan comes from: a subscription, set by Planary staff, Free because an invoice is overdue, or the default. */
  planSource: "subscription" | "override" | "overdue" | "default";
  /** Cancelling: the day it falls back to Vault Free. */
  planUntil: number | null;
  /** After a downgrade: older versions are kept by the old plan's rules until then. */
  retentionUntil: number | null;
  createdAt: number;
  /** The storage limit that holds (staff can set one in place of the plan's). Missing from older API versions. */
  quota?: number;
  restrictions?: Restrictions;
}

/** What Planary staff have turned off for this vault, and why. */
export interface Restrictions {
  uploads: boolean;
  sharing: boolean;
  quota: number | null;
  reason: string | null;
  since: number | null;
}

/** The Vault subscription as planary-org bills it; null without one. */
export interface BillingRecord {
  current: "free" | "plus" | "pro";
  period: "month" | "year" | null;
  payBy: "card" | "invoice" | null;
  renewsAt: number | null;
  cancelAt: number | null;
  pending: { plan: "plus" | "pro"; period: "month" | "year" } | null;
}

export interface VaultUser {
  id: string;
  email: string;
  name: string;
}

export interface NodeRecord {
  id: string;
  parentId: string | null;
  kind: "file" | "folder";
  encMeta: string;
  wrappedKey: string | null;
  /** The node key wrapped by its parent folder's key (null at the top level). */
  parentKey: string | null;
  /** Set on nodes shared with you directly; the rest of a shared folder opens through parentKey. */
  sealedKey?: string | null;
  role?: "view" | "edit";
  ownerName?: string;
  version: number;
  size: number;
  totalSize: number;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  sharedWith: string[];
}

export interface NodesResponse {
  nodes: NodeRecord[];
  shared: NodeRecord[];
  usage: { used: number; plan: string; quota?: number; restrictions?: Restrictions };
}

export interface VersionRecord {
  n: number;
  size: number;
  createdAt: number;
  /** null = you */
  by: string | null;
}

export interface ActivityRecord {
  id: number;
  /** null = you */
  actor: string | null;
  isLink: boolean;
  action: "uploaded" | "viewed" | "shared" | "unshared" | "link_created" | "link_revoked" | "link_downloaded" | "restored";
  detail: { version?: number; name?: string; role?: string; expiresAt?: number | null } | null;
  createdAt: number;
}

export interface ShareRecord {
  id: string;
  role: "view" | "edit";
  name: string;
  email: string;
  createdAt: number;
}

export interface LinkRecord {
  id: string;
  hasPassword: boolean;
  expiresAt: number | null;
  downloadLimit: number | null;
  downloads: number;
  createdAt: number;
}

export interface DeviceRecord {
  id: string;
  agent: string;
  place: string | null;
  lastSeen: number;
}
