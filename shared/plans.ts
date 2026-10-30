// Plan limits, shared by the API (which enforces them) and the app (which shows them).

const GB = 1024 ** 3;

export type PlanId = "free" | "plus" | "pro";

export interface Plan {
  id: PlanId;
  name: string;
  quota: number;
  maxFile: number;
  /** Longest link lifetime in days; null = no limit. */
  linkDays: number | null;
  /** Most downloads a link allows; null = unlimited. */
  linkDownloads: number | null;
  monthly: number;
}

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Vault", quota: 10 * GB, maxFile: 2 * GB, linkDays: 7, linkDownloads: 10, monthly: 0 },
  plus: { id: "plus", name: "Vault Plus", quota: 200 * GB, maxFile: 20 * GB, linkDays: 365, linkDownloads: 100, monthly: 4 },
  pro: { id: "pro", name: "Vault Pro", quota: 2048 * GB, maxFile: 50 * GB, linkDays: null, linkDownloads: null, monthly: 10 },
};

export function planOf(id: string | null | undefined): Plan {
  return PLANS[(id as PlanId) in PLANS ? (id as PlanId) : "free"];
}

/** Plaintext bytes per encrypted chunk. Each chunk is one R2 part, and parts must be at least 5 MiB. */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/** AES-GCM tag added to every chunk. */
export const TAG_SIZE = 16;
