-- Folder sharing: every node inside a folder also carries its key wrapped by the parent
-- folder's key. Whoever holds a folder key (the owner, or someone it was shared with) can
-- unwrap everything below it. NULL for top-level nodes, and for older nodes until the
-- owner's browser fills it in on the next unlock.

ALTER TABLE nodes ADD COLUMN parent_key TEXT;
ALTER TABLE uploads ADD COLUMN parent_key TEXT;
