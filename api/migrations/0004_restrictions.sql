-- Restrictions Planary staff set on one person's vault (through planary-org's Console).
-- Uploads off, sharing off (no new links or shares) and a storage limit that replaces the plan's.
ALTER TABLE vaults ADD COLUMN no_uploads INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vaults ADD COLUMN no_sharing INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vaults ADD COLUMN quota_override INTEGER;
ALTER TABLE vaults ADD COLUMN restrict_reason TEXT;
ALTER TABLE vaults ADD COLUMN restricted_at INTEGER;
