import { argon2id } from "hash-wasm";

/**
 * Vault's key hierarchy, all of it in the browser.
 *
 *   passphrase ──Argon2id──▶ passphrase key ─┐
 *                                            ├─ wrap ─▶ master key (random, 256 bit)
 *   recovery key ──HKDF────▶ recovery key ───┘              │
 *                                                           ├─ wraps every file and folder key
 *                                                           └─ wraps the X25519 private key
 *
 *   file key (random per file) ─▶ AES-256-GCM over 8 MiB chunks, and over the file's name/tags
 *   sharing: file key sealed to the recipient's X25519 public key
 *   links:   file key in the URL fragment, which browsers never send to a server
 *
 * Everything the server stores is either ciphertext or a public key.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── Encoding ────────────────────────────────────────────────────────────────

export function toB64(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < view.length; i += 0x8000) s += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(b64.length / 4) * 4, "="));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export const toB64Url = (bytes: Uint8Array | ArrayBuffer) => toB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ── Symmetric keys ──────────────────────────────────────────────────────────

const AES = { name: "AES-GCM", length: 256 } as const;

/** Keys are extractable so they can be wrapped for someone else or put into a link. */
export async function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, AES, true, ["encrypt", "decrypt"]);
}

export async function newAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(AES, true, ["encrypt", "decrypt"]);
}

export async function exportKey(key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", key));
}

/** iv ‖ ciphertext, base64. */
export async function seal(key: CryptoKey, data: Uint8Array<ArrayBuffer>): Promise<string> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data));
  return toB64(concat(iv, ct));
}

export async function open(key: CryptoKey, sealed: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = fromB64(sealed);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.subarray(0, 12) }, key, bytes.subarray(12)));
}

export async function sealJson(key: CryptoKey, value: unknown): Promise<string> {
  return seal(key, enc.encode(JSON.stringify(value)));
}

export async function openJson<T>(key: CryptoKey, sealed: string): Promise<T> {
  return JSON.parse(dec.decode(await open(key, sealed))) as T;
}

export async function wrapKey(wrapping: CryptoKey, key: CryptoKey): Promise<string> {
  return seal(wrapping, await exportKey(key));
}

export async function unwrapKey(wrapping: CryptoKey, wrapped: string): Promise<CryptoKey> {
  return importAesKey(await open(wrapping, wrapped));
}

// ── Passphrase ──────────────────────────────────────────────────────────────

export interface KdfParams {
  alg: "argon2id";
  salt: string;
  /** KiB */
  memory: number;
  iterations: number;
  parallelism: number;
}

export function newKdfParams(): KdfParams {
  return { alg: "argon2id", salt: toB64(randomBytes(16)), memory: 64 * 1024, iterations: 3, parallelism: 1 };
}

export async function passphraseKey(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  const raw = await argon2id({
    password: passphrase.normalize("NFKC"),
    salt: fromB64(kdf.salt),
    memorySize: kdf.memory,
    iterations: kdf.iterations,
    parallelism: kdf.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return importAesKey(new Uint8Array(raw));
}

export const MIN_PASSPHRASE = 12;

/** 0–4 bars. Length does most of the work; a mix of character kinds helps a little. */
export function passphraseStrength(p: string): { bars: number; label: string } {
  if (!p) return { bars: 0, label: "" };
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(p)).length;
  const words = p.trim().split(/\s+/).length;
  let score = p.length >= 24 ? 3 : p.length >= 16 ? 2 : p.length >= MIN_PASSPHRASE ? 1 : 0;
  if (kinds >= 3 || words >= 4) score += 1;
  if (p.length < MIN_PASSPHRASE) score = Math.min(score, 1);
  const bars = Math.max(1, Math.min(4, score));
  return { bars, label: ["", "Weak", "Fair", "Strong", "Very strong"][bars] };
}

// ── Recovery key ────────────────────────────────────────────────────────────

/** No 0/O or 1/I, so a printed key can't be misread. 32 symbols, 5 bits each. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 8 groups of 4: 160 random bits. */
export function newRecoveryKey(): string {
  const bytes = randomBytes(20);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join("-");
}

export function normalizeRecoveryKey(input: string): string | null {
  const clean = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 32 || [...clean].some((c) => !ALPHABET.includes(c))) return null;
  return clean.match(/.{4}/g)!.join("-");
}

/** The recovery key already carries 160 bits, so HKDF is enough; no slow hash needed. */
export async function recoveryKey(recovery: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", enc.encode(recovery.replace(/-/g, "")), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("planary-vault"), info: enc.encode("recovery key") },
    base,
    AES,
    false,
    ["encrypt", "decrypt"],
  );
}

// ── Key pairs for sharing ───────────────────────────────────────────────────

export interface KeyPair {
  publicKey: Uint8Array<ArrayBuffer>;
  privateKey: CryptoKey;
}

export async function newKeyPair(): Promise<{ publicKey: Uint8Array<ArrayBuffer>; privatePkcs8: Uint8Array<ArrayBuffer> }> {
  const pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    publicKey: new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
    privatePkcs8: new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey)),
  };
}

export async function importPrivateKey(pkcs8: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "X25519" }, false, ["deriveBits"]);
}

async function sharedKey(privateKey: CryptoKey, theirPublic: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const pub = await crypto.subtle.importKey("raw", theirPublic, { name: "X25519" }, false, []);
  const secret = await crypto.subtle.deriveBits({ name: "X25519", public: pub }, privateKey, 256);
  const base = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt, info: enc.encode("planary-vault share") }, base, AES, false, [
    "encrypt",
    "decrypt",
  ]);
}

/** Seals a file key so only the holder of `recipientPublic`'s private key can open it. */
export async function sealForRecipient(fileKey: CryptoKey, recipientPublic: Uint8Array<ArrayBuffer>): Promise<string> {
  const eph = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  const ephPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const key = await sharedKey(eph.privateKey, recipientPublic, concat(ephPublic, recipientPublic));
  return toB64(concat(ephPublic, fromB64(await seal(key, await exportKey(fileKey)))));
}

export async function openFromSender(sealed: string, pair: KeyPair): Promise<CryptoKey> {
  const bytes = fromB64(sealed);
  const ephPublic = bytes.slice(0, 32);
  const key = await sharedKey(pair.privateKey, ephPublic, concat(ephPublic, pair.publicKey));
  return importAesKey(await open(key, toB64(bytes.subarray(32))));
}

// ── File contents ───────────────────────────────────────────────────────────

/** Per chunk: nonce = 8 random bytes per version ‖ chunk index; AAD marks the last chunk so truncation fails. */
function chunkParams(prefix: Uint8Array<ArrayBuffer>, index: number, last: boolean): AesGcmParams {
  const iv = new Uint8Array(12);
  iv.set(prefix, 0);
  new DataView(iv.buffer).setUint32(8, index);
  return { name: "AES-GCM", iv, additionalData: new Uint8Array([last ? 1 : 0]) };
}

export async function encryptChunk(key: CryptoKey, prefix: Uint8Array<ArrayBuffer>, index: number, last: boolean, data: ArrayBuffer) {
  return new Uint8Array(await crypto.subtle.encrypt(chunkParams(prefix, index, last), key, data));
}

export async function decryptChunk(key: CryptoKey, prefix: Uint8Array<ArrayBuffer>, index: number, last: boolean, data: Uint8Array<ArrayBuffer>) {
  return new Uint8Array(await crypto.subtle.decrypt(chunkParams(prefix, index, last), key, data));
}
