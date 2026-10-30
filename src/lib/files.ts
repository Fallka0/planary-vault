import { CHUNK_SIZE, TAG_SIZE } from "../../shared/plans";
import { VAULT_API, api, apiRaw, deviceId, ApiError } from "./api";
import { decryptChunk, encryptChunk, fromB64, newAesKey, randomBytes, sealJson, toB64, wrapKey } from "./crypto";

/** What the server stores as `encMeta` for a file, encrypted with the file key. */
export interface FileMeta {
  name: string;
  mime: string;
  /** Plaintext bytes. */
  size: number;
  tags: string[];
  pages?: number;
}

export interface FolderMeta {
  name: string;
}

export type UploadPhase = "encrypting" | "uploading";

let accessToken = "";
export function setUploadToken(token: string) {
  accessToken = token;
}

/** fetch() can't report upload progress, so parts go through XHR. */
function putPart(path: string, body: Uint8Array<ArrayBuffer>, onBytes: (n: number) => void, signal: AbortSignal) {
  return new Promise<{ n: number; etag: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${VAULT_API}${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${accessToken}`);
    const device = deviceId();
    if (device) xhr.setRequestHeader("X-Vault-Device", device);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText));
      else reject(new ApiError(xhr.status, "Upload failed"));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed"));
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/**
 * Encrypts a file in 8 MiB chunks and streams them to the vault as one
 * multipart upload. Only ciphertext and the wrapped key leave the browser.
 */
export async function uploadFile(opts: {
  file: File;
  masterKey: CryptoKey;
  parentId: string | null;
  /** Upload a new version of this file instead of a new file. */
  existing?: { id: string; key: CryptoKey; meta: FileMeta };
  tags?: string[];
  signal: AbortSignal;
  onProgress: (phase: UploadPhase, done: number, total: number) => void;
}): Promise<string> {
  const { file, signal } = opts;
  const key = opts.existing?.key ?? (await newAesKey());
  const meta: FileMeta = {
    ...(opts.existing?.meta ?? { tags: opts.tags ?? [] }),
    name: opts.existing?.meta.name ?? file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
  delete meta.pages;
  const nonce = randomBytes(8);
  const parts = Math.max(1, Math.ceil(file.size / CHUNK_SIZE));
  const total = file.size + parts * TAG_SIZE;

  opts.onProgress("encrypting", 0, total);
  const start = await api<{ uploadId: string; nodeId: string }>("/uploads", {
    method: "POST",
    body: {
      nodeId: opts.existing?.id,
      parentId: opts.parentId,
      encMeta: await sealJson(key, meta),
      wrappedKey: opts.existing ? undefined : await wrapKey(opts.masterKey, key),
      size: file.size,
      nonce: toB64(nonce),
    },
  });

  try {
    const done: { n: number; etag: string }[] = [];
    let sent = 0;
    for (let i = 0; i < parts; i++) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const plain = await file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE).arrayBuffer();
      const cipher = await encryptChunk(key, nonce, i, i === parts - 1, plain);
      if (sent === 0) opts.onProgress("encrypting", cipher.length, total);
      const base = sent;
      done.push(
        await putPart(`/uploads/${start.uploadId}/parts/${i + 1}`, cipher, (n) => opts.onProgress("uploading", base + n, total), signal),
      );
      sent += cipher.length;
      opts.onProgress("uploading", sent, total);
    }
    await api(`/uploads/${start.uploadId}/complete`, { method: "POST", body: { parts: done } });
    return start.nodeId;
  } catch (error) {
    void api(`/uploads/${start.uploadId}`, { method: "DELETE" }).catch(() => undefined);
    throw error;
  }
}

/** Reads a ciphertext stream and decrypts it chunk by chunk as the bytes arrive. */
async function decryptStream(res: Response, key: CryptoKey, mime: string, onProgress?: (done: number, total: number) => void): Promise<Blob> {
  const total = Number(res.headers.get("Content-Length")) || 0;
  const nonce = fromB64(res.headers.get("X-Vault-Nonce") ?? "");
  if (!res.body || nonce.length !== 8) throw new Error("Unreadable file");
  const reader = res.body.getReader();
  const step = CHUNK_SIZE + TAG_SIZE;
  const out: BlobPart[] = [];
  let buffer = new Uint8Array(step);
  let filled = 0;
  let received = 0;
  let index = 0;

  onProgress?.(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    let offset = 0;
    received += value.length;
    while (offset < value.length) {
      const take = Math.min(step - filled, value.length - offset);
      buffer.set(value.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
      // A full chunk that isn't the end of the stream.
      if (filled === step && received < total) {
        out.push(await decryptChunk(key, nonce, index++, false, buffer));
        buffer = new Uint8Array(step);
        filled = 0;
      }
    }
    onProgress?.(received, total);
  }
  out.push(await decryptChunk(key, nonce, index, true, buffer.slice(0, filled)));
  return new Blob(out, { type: mime });
}

export async function downloadNode(nodeId: string, key: CryptoKey, mime: string, version?: number, onProgress?: (done: number, total: number) => void) {
  const res = await apiRaw(`/nodes/${nodeId}/content${version ? `?v=${version}` : ""}`);
  return decryptStream(res, key, mime, onProgress);
}

export async function downloadLink(linkId: string, password: string, key: CryptoKey, mime: string, onProgress?: (done: number, total: number) => void) {
  const res = await fetch(`${VAULT_API}/public/links/${linkId}/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) {
    const { error } = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, error || "Download failed");
  }
  return decryptStream(res, key, mime, onProgress);
}

/** Hands a decrypted Blob to the browser as a download. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
