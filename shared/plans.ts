// Plan limits, shared by the API (which enforces them) and the app (which shows them).
// Billing lives in planary-org (ADR 0003 there); the API caches the plan it reports.

const GB = 1024 ** 3;

export type PlanId = "free" | "plus" | "pro";
export type Period = "month" | "year";

export interface Plan {
  id: PlanId;
  name: string;
  /** One line for the plan cards. */
  tagline: string;
  quota: number;
  maxFile: number;
  /** Longest link lifetime in days; null = no limit. */
  linkDays: number | null;
  /** Most downloads a link allows; null = unlimited. */
  linkDownloads: number | null;
  /** How long older versions are kept, in days; null = all of them. */
  versionDays: number | null;
  /** CHF per month, and per year (one invoice). */
  monthly: number;
  yearly: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Vault Free",
    tagline: "For your important papers.",
    quota: 10 * GB,
    maxFile: 2 * GB,
    linkDays: 7,
    linkDownloads: 10,
    versionDays: 30,
    monthly: 0,
    yearly: 0,
  },
  plus: {
    id: "plus",
    name: "Vault Plus",
    tagline: "For a whole household of paperwork.",
    quota: 200 * GB,
    maxFile: 20 * GB,
    linkDays: 365,
    linkDownloads: 100,
    versionDays: 365,
    monthly: 4,
    yearly: 40,
  },
  pro: {
    id: "pro",
    name: "Vault Pro",
    tagline: "For families and small teams.",
    quota: 2048 * GB,
    maxFile: 50 * GB,
    linkDays: null,
    linkDownloads: null,
    versionDays: null,
    monthly: 10,
    yearly: 100,
  },
};

export const PLAN_IDS: readonly PlanId[] = ["free", "plus", "pro"];

export function planOf(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "free"];
}

/** Higher is more: free < plus < pro. */
export const planRank = (id: PlanId) => PLAN_IDS.indexOf(id);

/** Items in the Trash are deleted for good after this many days, on every plan. */
export const TRASH_DAYS = 30;

/** After a downgrade, older versions are kept by the old plan's rules for this many days. */
export const RETENTION_GRACE_DAYS = 30;

/** Plaintext bytes per encrypted chunk. Each chunk is one R2 part, and parts must be at least 5 MiB. */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** AES-GCM tag added to every chunk. */
export const TAG_SIZE = 16;
