export interface Env {
  /** Vaults, encrypted metadata, shares, links, activity and devices. */
  DB: D1Database;
  /** Ciphertext only: one object per file version. */
  BLOBS: R2Bucket;
  /** planary-auth base URL used to verify tokens (defaults to https://auth.planary.ch). */
  AUTH_API_URL?: string;
  /** Comma-separated origins allowed to call this worker from a browser. */
  ALLOWED_ORIGINS?: string;
  /** planary-org, which bills Vault (default https://org.planary.ch). */
  ORG_API_URL?: string;
  /** Shared secret for planary-org's /internal routes. Without it the cached plan is used as it is. */
  INTERNAL_KEY?: string;
  /** Where people come back to after paying (default https://vault.planary.ch). */
  APP_URL?: string;
}
