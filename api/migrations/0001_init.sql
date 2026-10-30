-- Everything the server holds about a vault. Names, tags and file contents only ever
-- arrive here as ciphertext; what stays readable is listed in docs/BRIEF.md section 8.

CREATE TABLE vaults (
  user_id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  kdf TEXT NOT NULL,                 -- JSON: Argon2id parameters and salt
  wrapped_master_pw TEXT NOT NULL,   -- master key wrapped by the passphrase key
  wrapped_master_rk TEXT NOT NULL,   -- master key wrapped by the recovery key
  public_key TEXT NOT NULL,          -- X25519, for files shared with this person
  wrapped_private_key TEXT NOT NULL, -- X25519 private key wrapped by the master key
  auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX vaults_email ON vaults (email);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  parent_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
  enc_meta TEXT NOT NULL,            -- name, tags, type: encrypted with the node key
  wrapped_key TEXT NOT NULL,         -- node key wrapped by the owners master key
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  trashed_at INTEGER
);
CREATE INDEX nodes_owner ON nodes (owner_id);
CREATE INDEX nodes_parent ON nodes (parent_id);

CREATE TABLE versions (
  node_id TEXT NOT NULL,
  n INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  nonce TEXT NOT NULL,               -- random prefix for the chunk nonces
  size INTEGER NOT NULL,             -- ciphertext bytes
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (node_id, n)
);

CREATE TABLE uploads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  is_new INTEGER NOT NULL,
  parent_id TEXT,
  enc_meta TEXT NOT NULL,
  wrapped_key TEXT,
  nonce TEXT NOT NULL,
  size INTEGER NOT NULL,
  blob_key TEXT NOT NULL,
  r2_upload_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE shares (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('view', 'edit')),
  sealed_key TEXT NOT NULL,          -- node key sealed to the recipients public key
  created_at INTEGER NOT NULL,
  UNIQUE (node_id, recipient_id)
);
CREATE INDEX shares_recipient ON shares (recipient_id);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  password_hash TEXT,                -- PBKDF2; the password guards the ciphertext download
  expires_at INTEGER,
  download_limit INTEGER,
  downloads INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX links_node ON links (node_id);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  node_id TEXT NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX activity_node ON activity (node_id, created_at);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  agent TEXT NOT NULL,
  place TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX devices_user ON devices (user_id);
