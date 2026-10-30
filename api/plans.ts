import type { Env } from "./env";
import { planOf, planRank, RETENTION_GRACE_DAYS, TRASH_DAYS, type PlanId } from "../shared/plans";

/**
 * Plans and billing. planary-org bills Vault (its ADR 0003) and says what each person may use
 * through /internal/entitlements; the vault row keeps a copy so limits hold while it is unreachable.
 * Checkout and plan changes go to planary-org's portal API with the person's own token.
 */

const DAY = 86_400_000;
/** How long a fetched plan is trusted before asking planary-org again. */
const PLAN_TTL = 5 * 60_000;

export interface PlanRow {
  user_id: string;
  plan: string;
  plan_source: string | null;
  plan_until: number | null;
  plan_checked_at: number | null;
  billing_org: string | null;
  retention_plan: string | null;
  retention_until: number | null;
}

interface Entitlement {
  plan: PlanId;
  source: "subscription" | "override" | "overdue" | "default";
  until: number | null;
  orgId: string | null;
}

export class BillingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const orgBase = (env: Env) => (env.ORG_API_URL || "https://org.planary.ch").replace(/\/+$/, "");
export const appUrl = (env: Env) => (env.APP_URL || "https://vault.planary.ch").replace(/\/+$/, "");

/**
 * Asks planary-org for the person's plan (at most every few minutes, or now with `force`) and stores it.
 * A step down starts a grace period in which older versions are kept by the old plan's rules.
 * Without INTERNAL_KEY, or when planary-org doesn't answer, the stored plan stands.
 */
export async function syncPlan<T extends PlanRow>(env: Env, row: T, force = false): Promise<T> {
  const now = Date.now();
  if (!env.INTERNAL_KEY || (!force && row.plan_checked_at && row.plan_checked_at > now - PLAN_TTL)) return row;
  let ent: Entitlement;
  try {
    const res = await fetch(`${orgBase(env)}/internal/entitlements?user=${encodeURIComponent(row.user_id)}`, {
      headers: { "x-internal-key": env.INTERNAL_KEY },
    });
    if (!res.ok) return row;
    ent = ((await res.json()) as { vault: Entitlement }).vault;
  } catch {
    return row;
  }
  const plan = planOf(ent.plan).id;
  const before = planOf(row.plan).id;
  let retentionPlan = row.retention_plan;
  let retentionUntil = row.retention_until;
  if (planRank(plan) < planRank(before)) {
    // Keep the most generous rules still in their grace period.
    const graced = retentionUntil && retentionUntil > now && planRank(planOf(retentionPlan).id) > planRank(before) ? planOf(retentionPlan).id : before;
    retentionPlan = graced;
    retentionUntil = now + RETENTION_GRACE_DAYS * DAY;
  }
  const next = {
    ...row,
    plan,
    plan_source: ent.source,
    plan_until: ent.until,
    billing_org: ent.orgId ?? row.billing_org,
    plan_checked_at: now,
    retention_plan: retentionPlan,
    retention_until: retentionUntil,
  };
  await env.DB.prepare(
    `UPDATE vaults SET plan = ?, plan_source = ?, plan_until = ?, billing_org = ?, plan_checked_at = ?, retention_plan = ?, retention_until = ?
     WHERE user_id = ?`,
  )
    .bind(next.plan, next.plan_source, next.plan_until, next.billing_org, now, next.retention_plan, next.retention_until, row.user_id)
    .run();
  return next;
}

/** Calls planary-org's portal API as the person (their Planary token). Its errors come through as they are. */
export async function orgCall<T>(env: Env, request: Request, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${orgBase(env)}/portal${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: request.headers.get("Authorization") ?? "",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new BillingError(503, "Billing isn't reachable right now. Try again in a minute.");
  }
  if (!res.ok) {
    const { error, code } = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (code === "billing_not_configured") throw new BillingError(503, "Plans can't be bought yet.");
    // Anything else says what went wrong (planary-org logs the provider's reason).
    throw new BillingError(res.status >= 500 ? 503 : res.status, error || `Billing said no (${res.status})`);
  }
  return (await res.json()) as T;
}

// ── Daily cleanup ───────────────────────────────────────────────────────────

/**
 * Empties the Trash after TRASH_DAYS, drops older versions past the plan's history (the current
 * version always stays) and aborts uploads nobody finished. `deleteTree` is the worker's own.
 */
export async function cleanup(env: Env, deleteTree: (id: string) => Promise<void>, now = Date.now()) {
  const trashed = await env.DB.prepare("SELECT id FROM nodes WHERE trashed_at IS NOT NULL AND trashed_at < ? LIMIT 200")
    .bind(now - TRASH_DAYS * DAY)
    .all<{ id: string }>();
  for (const { id } of trashed.results) await deleteTree(id);

  const vaults = await env.DB.prepare("SELECT user_id, plan, retention_plan, retention_until FROM vaults").all<Pick<PlanRow, "user_id" | "plan" | "retention_plan" | "retention_until">>();
  for (const v of vaults.results) {
    const graced = v.retention_until && v.retention_until > now ? planOf(v.retention_plan) : null;
    const plan = graced && planRank(graced.id) > planRank(planOf(v.plan).id) ? graced : planOf(v.plan);
    if (plan.versionDays === null) continue;
    // A version is kept for versionDays after the one that replaced it.
    const old = await env.DB.prepare(
      `SELECT v.node_id, v.n, v.blob_key FROM versions v JOIN nodes n ON n.id = v.node_id
       WHERE n.owner_id = ? AND v.n < n.version
         AND (SELECT MIN(w.created_at) FROM versions w WHERE w.node_id = v.node_id AND w.n > v.n) < ?
       LIMIT 500`,
    )
      .bind(v.user_id, now - plan.versionDays * DAY)
      .all<{ node_id: string; n: number; blob_key: string }>();
    if (!old.results.length) continue;
    await env.DB.batch(old.results.map((o) => env.DB.prepare("DELETE FROM versions WHERE node_id = ? AND n = ?").bind(o.node_id, o.n)));
    // Restored versions share an object with an older one: delete only what nothing points at any more.
    for (const key of new Set(old.results.map((o) => o.blob_key))) {
      const used = await env.DB.prepare("SELECT 1 FROM versions WHERE blob_key = ? LIMIT 1").bind(key).first();
      if (!used) await env.BLOBS.delete(key);
    }
  }

  const stale = await env.DB.prepare("SELECT id, blob_key, r2_upload_id FROM uploads WHERE created_at < ? LIMIT 200")
    .bind(now - DAY)
    .all<{ id: string; blob_key: string; r2_upload_id: string }>();
  for (const u of stale.results) {
    await env.BLOBS.resumeMultipartUpload(u.blob_key, u.r2_upload_id)
      .abort()
      .catch(() => undefined);
    await env.DB.prepare("DELETE FROM uploads WHERE id = ?").bind(u.id).run();
  }
}
