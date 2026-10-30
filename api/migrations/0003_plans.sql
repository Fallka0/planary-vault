-- The plan comes from planary-org (/internal/entitlements); this is the cached copy and what it said.

ALTER TABLE vaults ADD COLUMN plan_source TEXT;          -- subscription, override, overdue, default
ALTER TABLE vaults ADD COLUMN plan_until INTEGER;        -- cancelling: the day it falls back to Vault Free
ALTER TABLE vaults ADD COLUMN plan_checked_at INTEGER;
ALTER TABLE vaults ADD COLUMN billing_org TEXT;          -- the planary-org account that pays for it
-- After a downgrade, older versions are kept by the old plan's rules until retention_until.
ALTER TABLE vaults ADD COLUMN retention_plan TEXT;
ALTER TABLE vaults ADD COLUMN retention_until INTEGER;
