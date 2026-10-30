export interface Env {
  /** Vaults, encrypted metadata, shares, links, activity and devices. */
  DB: D1Database;
  /** Ciphertext only: one object per file version. */
  BLOBS: R2Bucket;
  /** planary-auth base URL used to verify tokens (defaults to https://auth.planary.ch). */
  AUTH_API_URL?: string;
  /** Comma-separated origins allowed to call this worker from a browser. */
  ALLOWED_ORIGINS?: string;
}
