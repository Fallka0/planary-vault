"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { api, type NodeRecord, type NodesResponse, type Restrictions, type VaultRecord, type VaultUser } from "@/lib/api";
import {
  fromB64,
  importPrivateKey,
  newAesKey,
  newKdfParams,
  newKeyPair,
  normalizeRecoveryKey,
  open,
  openFromSender,
  openJson,
  passphraseKey,
  recoveryKey,
  seal,
  sealJson,
  toB64,
  unwrapKey,
  wrapKey,
  type KeyPair,
} from "@/lib/crypto";
import { uploadFile, type FileMeta, type FolderMeta, type UploadPhase } from "@/lib/files";
import { planOf, type Plan } from "../../shared/plans";
import { Curtain } from "./Curtain";
import { useAuth } from "./AuthProvider";

/** A file or folder after its metadata has been decrypted in this browser. */
export interface Item {
  id: string;
  kind: "file" | "folder";
  parentId: string | null;
  name: string;
  tags: string[];
  mime: string;
  /** Plaintext bytes (files). */
  size: number;
  /** Bytes stored, all versions. */
  storedSize: number;
  currentStoredSize: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  trashedAt: number | null;
  sharedWith: string[];
  key: CryptoKey;
  meta: FileMeta | FolderMeta;
  /** Set on files someone else shared with you. */
  incoming?: { role: "view" | "edit"; ownerName: string };
}

export interface UploadItem {
  id: string;
  name: string;
  state: "waiting" | UploadPhase | "done" | "failed";
  done: number;
  total: number;
  file: File;
  parentId: string | null;
  existing?: Item;
  error?: string;
  /** Failed on a plan limit (storage or file size). */
  limit?: boolean;
}

type Status = "loading" | "setup" | "locked" | "unlocked";

interface VaultState {
  status: Status;
  user: VaultUser;
  plan: Plan;
  used: number;
  autoLockMinutes: number;
  planSource: VaultRecord["planSource"];
  /** Set by Planary staff: uploads or sharing off, or a storage limit of their own. */
  restrictions: Restrictions | null;
  planUntil: number | null;
  retentionUntil: number | null;
  /** Asks again right away, e.g. after coming back from checkout. */
  reloadPlan: () => Promise<void>;
  items: Item[];
  byId: Map<string, Item>;
  refresh: () => Promise<void>;

  // keys
  unlock: (passphrase: string) => Promise<boolean>;
  unlockWithRecovery: (key: string) => Promise<boolean>;
  lock: () => void;
  setupPassphrase: string | null;
  setSetupPassphrase: (p: string | null) => void;
  createVault: (passphrase: string, recovery: string) => Promise<void>;
  changePassphrase: (passphrase: string) => Promise<void>;
  replaceRecoveryKey: (recovery: string) => Promise<void>;
  setAutoLock: (minutes: number) => Promise<void>;
  keyPair: () => KeyPair | null;

  // files
  createFolder: (name: string, parentId: string | null) => Promise<string>;
  updateMeta: (item: Item, patch: Partial<FileMeta & FolderMeta>) => Promise<void>;
  setTrashed: (item: Item, trashed: boolean) => Promise<void>;
  deleteForever: (item: Item) => Promise<void>;

  // uploads
  uploads: UploadItem[];
  enqueue: (files: File[], parentId: string | null, existing?: Item) => void;
  retryUpload: (id: string) => void;
  clearUploads: () => void;
  currentFolder: string | null;
  setCurrentFolder: (id: string | null) => void;

  // search
  query: string;
  setQuery: (q: string) => void;
}

const VaultContext = createContext<VaultState | null>(null);

const OPEN_PATHS = ["/unlock", "/setup", "/setup/recovery"];

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const { user: authUser } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [status, setStatus] = useState<Status>("loading");
  const [record, setRecord] = useState<VaultRecord | null>(null);
  const [user, setUser] = useState<VaultUser>(authUser);
  const [items, setItems] = useState<Item[]>([]);
  const [used, setUsed] = useState(0);
  const [planId, setPlanId] = useState("free");
  const [quota, setQuota] = useState<number | null>(null);
  const [restrictions, setRestrictions] = useState<Restrictions | null>(null);
  const [curtain, setCurtain] = useState<"cover" | "lift" | "hold" | null>("hold");
  const [setupPassphrase, setSetupPassphrase] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Key material: in memory only, dropped on lock.
  const master = useRef<CryptoKey | null>(null);
  const pair = useRef<KeyPair | null>(null);
  /** Decrypted items keyed by id; reused while the ciphertext is unchanged. */
  const cache = useRef(new Map<string, { sig: string; item: Item }>());
  const intended = useRef<string>("/");

  // ── Load the vault record
  useEffect(() => {
    let active = true;
    api<{ exists: boolean; user: VaultUser; vault?: VaultRecord }>("/vault")
      .then((res) => {
        if (!active) return;
        setUser(res.user);
        if (!res.exists || !res.vault) {
          setStatus("setup");
        } else {
          setRecord(res.vault);
          setPlanId(res.vault.plan);
          setQuota(res.vault.quota ?? null);
          setRestrictions(res.vault.restrictions ?? null);
          setStatus("locked");
        }
      })
      .catch(() => {
        // Keep the curtain up; the API layer sends 401s back through sign-in.
      });
    return () => {
      active = false;
    };
  }, []);

  // ── Route guard: each status has the pages it may show
  useEffect(() => {
    if (status === "loading") return;
    if (status === "setup" && !pathname.startsWith("/setup")) router.replace("/setup");
    else if (status === "setup" && pathname === "/setup/recovery" && !setupPassphrase) router.replace("/setup");
    else if (status === "locked" && pathname !== "/unlock") {
      // Keep the query too: /plans?checkout=done comes back from paying to a locked vault.
      intended.current = `${pathname}${window.location.search}`;
      router.replace("/unlock");
    } else if (status === "unlocked" && OPEN_PATHS.includes(pathname)) router.replace(intended.current || "/");
  }, [status, pathname, router, setupPassphrase]);

  // ── Decrypt the file list
  const refresh = useCallback(async () => {
    const m = master.current;
    const p = pair.current;
    if (!m || !p) return;
    const res = await api<NodesResponse>("/nodes");
    const decrypt = async (n: NodeRecord, openKey: () => Promise<CryptoKey>): Promise<Item | null> => {
      const sig = `${n.encMeta}|${n.wrappedKey ?? n.sealedKey ?? n.parentKey}|${n.role}|${n.version}|${n.updatedAt}|${n.trashedAt}|${n.parentId}|${n.sharedWith.join(",")}|${n.totalSize}`;
      const hit = cache.current.get(n.id);
      if (hit?.sig === sig) return hit.item;
      try {
        const key = await openKey();
        const meta = await openJson<FileMeta & FolderMeta>(key, n.encMeta);
        const item: Item = {
          id: n.id,
          kind: n.kind,
          parentId: n.parentId,
          name: meta.name,
          tags: meta.tags ?? [],
          mime: meta.mime ?? "",
          size: meta.size ?? 0,
          storedSize: n.totalSize,
          currentStoredSize: n.size,
          version: n.version,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
          trashedAt: n.trashedAt,
          sharedWith: n.sharedWith,
          key,
          meta,
          incoming: n.role ? { role: n.role, ownerName: n.ownerName ?? "Someone" } : undefined,
        };
        cache.current.set(n.id, { sig, item });
        return item;
      } catch {
        // A row we can't open (a damaged key, a revoked share) is left out rather than breaking the list.
        return null;
      }
    };
    const own = (await Promise.all(res.nodes.map((n) => decrypt(n, () => unwrapKey(m, n.wrappedKey!))))).filter((i): i is Item => i !== null);

    // Shared with you: a node shared directly opens with your private key, anything inside a
    // shared folder with its parent's key, so they open one folder level at a time.
    const shared = new Map<string, Item>();
    let pending = res.shared;
    while (pending.length) {
      const ready = pending.filter((n) => n.sealedKey || (n.parentId && shared.has(n.parentId)));
      if (!ready.length) break;
      const opened = await Promise.all(
        ready.map((n) => decrypt(n, () => (n.sealedKey ? openFromSender(n.sealedKey, p) : unwrapKey(shared.get(n.parentId!)!.key, n.parentKey!)))),
      );
      for (const item of opened) if (item) shared.set(item.id, item);
      pending = pending.filter((n) => !ready.includes(n));
    }

    // Nodes from before folder sharing have no parent-wrapped key yet; add it so sharing a folder reaches them.
    const ownById = new Map(own.map((i) => [i.id, i]));
    const missing = res.nodes.filter((n) => n.parentId && !n.parentKey && ownById.has(n.id) && ownById.has(n.parentId));
    for (let i = 0; i < missing.length; i += 500) {
      const keys = await Promise.all(
        missing.slice(i, i + 500).map(async (n) => ({ id: n.id, parentKey: await wrapKey(ownById.get(n.parentId!)!.key, ownById.get(n.id)!.key) })),
      );
      await api("/nodes/parent-keys", { method: "POST", body: { keys } });
    }

    setItems([...own, ...shared.values()]);
    setUsed(res.usage.used);
    setPlanId(res.usage.plan);
    setQuota(res.usage.quota ?? null);
    setRestrictions(res.usage.restrictions ?? null);
  }, []);

  const openVault = useCallback(
    async (m: CryptoKey, rec: VaultRecord) => {
      const pkcs8 = await open(m, rec.wrappedPrivateKey);
      master.current = m;
      pair.current = { publicKey: fromB64(rec.publicKey), privateKey: await importPrivateKey(pkcs8) };
      await refresh();
      setCurtain("lift");
      setStatus("unlocked");
    },
    [refresh],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      if (!record) return false;
      let m: CryptoKey;
      try {
        m = await unwrapKey(await passphraseKey(passphrase, record.kdf), record.wrappedMasterPw);
      } catch {
        return false;
      }
      await openVault(m, record);
      return true;
    },
    [record, openVault],
  );

  const unlockWithRecovery = useCallback(
    async (input: string) => {
      const normalized = normalizeRecoveryKey(input);
      if (!record || !normalized) return false;
      let m: CryptoKey;
      try {
        m = await unwrapKey(await recoveryKey(normalized), record.wrappedMasterRk);
      } catch {
        return false;
      }
      await openVault(m, record);
      return true;
    },
    [record, openVault],
  );

  const lock = useCallback(() => {
    setCurtain("cover");
  }, []);

  /** Runs when the cover has closed: now the keys go and /unlock comes up underneath. */
  const finishCover = useCallback(() => {
    master.current = null;
    pair.current = null;
    cache.current.clear();
    setItems([]);
    setUploads([]);
    setQuery("");
    setStatus("locked");
    setCurtain("lift");
  }, []);

  const createVault = useCallback(
    async (passphrase: string, recovery: string) => {
      const m = await newAesKey();
      const kdf = newKdfParams();
      const keys = await newKeyPair();
      const body = {
        kdf,
        wrappedMasterPw: await wrapKey(await passphraseKey(passphrase, kdf), m),
        wrappedMasterRk: await wrapKey(await recoveryKey(recovery), m),
        publicKey: toB64(keys.publicKey),
        wrappedPrivateKey: await seal(m, keys.privatePkcs8),
      };
      await api("/vault", { method: "POST", body });
      const rec: VaultRecord = { ...body, autoLockMinutes: 15, plan: "free", planSource: "default", planUntil: null, retentionUntil: null, createdAt: Date.now() };
      setRecord(rec);
      setSetupPassphrase(null);
      intended.current = "/";
      await openVault(m, rec);
    },
    [openVault],
  );

  const changePassphrase = useCallback(
    async (passphrase: string) => {
      if (!master.current || !record) return;
      const kdf = newKdfParams();
      const wrappedMasterPw = await wrapKey(await passphraseKey(passphrase, kdf), master.current);
      await api("/vault/keys", { method: "PATCH", body: { kdf, wrappedMasterPw } });
      setRecord({ ...record, kdf, wrappedMasterPw });
    },
    [record],
  );

  const replaceRecoveryKey = useCallback(
    async (recovery: string) => {
      if (!master.current || !record) return;
      const wrappedMasterRk = await wrapKey(await recoveryKey(recovery), master.current);
      await api("/vault/keys", { method: "PATCH", body: { wrappedMasterRk } });
      setRecord({ ...record, wrappedMasterRk });
    },
    [record],
  );

  const setAutoLock = useCallback(
    async (minutes: number) => {
      if (!record) return;
      await api("/vault/settings", { method: "PATCH", body: { autoLockMinutes: minutes } });
      setRecord({ ...record, autoLockMinutes: minutes });
    },
    [record],
  );

  const reloadPlan = useCallback(async () => {
    const res = await api<{ vault?: VaultRecord }>("/vault?refresh=1");
    if (!res.vault) return;
    const fresh = res.vault;
    setRecord((r) => (r ? { ...r, plan: fresh.plan, planSource: fresh.planSource, planUntil: fresh.planUntil, retentionUntil: fresh.retentionUntil } : r));
    setPlanId(fresh.plan);
    setQuota(fresh.quota ?? null);
    setRestrictions(fresh.restrictions ?? null);
  }, []);

  // ── Auto-lock after idle
  const autoLockMinutes = record?.autoLockMinutes ?? 15;
  useEffect(() => {
    if (status !== "unlocked") return;
    let timer = 0;
    const arm = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(lock, autoLockMinutes * 60_000);
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    arm();
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
    };
  }, [status, autoLockMinutes, lock]);

  // ── Files and folders
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const createFolder = useCallback(
    async (name: string, parentId: string | null) => {
      if (!master.current) throw new Error("locked");
      const key = await newAesKey();
      const parent = parentId ? itemsRef.current.find((i) => i.id === parentId) : undefined;
      const { id } = await api<{ id: string }>("/folders", {
        method: "POST",
        body: {
          parentId,
          encMeta: await sealJson(key, { name } satisfies FolderMeta),
          wrappedKey: await wrapKey(master.current, key),
          parentKey: parent ? await wrapKey(parent.key, key) : undefined,
        },
      });
      await refresh();
      return id;
    },
    [refresh],
  );

  const updateMeta = useCallback(
    async (item: Item, patch: Partial<FileMeta & FolderMeta>) => {
      const meta = { ...item.meta, ...patch };
      await api(`/nodes/${item.id}`, { method: "PATCH", body: { encMeta: await sealJson(item.key, meta) } });
      await refresh();
    },
    [refresh],
  );

  const setTrashed = useCallback(
    async (item: Item, trashed: boolean) => {
      await api(`/nodes/${item.id}`, { method: "PATCH", body: { trashed } });
      await refresh();
    },
    [refresh],
  );

  const deleteForever = useCallback(
    async (item: Item) => {
      await api(`/nodes/${item.id}`, { method: "DELETE" });
      cache.current.delete(item.id);
      await refresh();
    },
    [refresh],
  );

  // ── Upload queue: one file at a time, in order
  const running = useRef(false);
  const controllers = useRef(new Map<string, AbortController>());
  const uploadsRef = useRef(uploads);
  useEffect(() => {
    uploadsRef.current = uploads;
  }, [uploads]);

  const patchUpload = useCallback((id: string, patch: Partial<UploadItem>) => {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  }, []);

  const pump = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      for (;;) {
        const next = uploadsRef.current.find((u) => u.state === "waiting");
        if (!next || !master.current) break;
        const controller = new AbortController();
        controllers.current.set(next.id, controller);
        // Mark it right away so the next lookup moves on even before React re-renders.
        uploadsRef.current = uploadsRef.current.map((u) => (u.id === next.id ? { ...u, state: "encrypting" } : u));
        patchUpload(next.id, { state: "encrypting", done: 0 });
        try {
          await uploadFile({
            file: next.file,
            masterKey: master.current,
            parentId: next.parentId,
            parentKey: next.parentId ? itemsRef.current.find((i) => i.id === next.parentId)?.key : undefined,
            existing: next.existing ? { id: next.existing.id, key: next.existing.key, meta: next.existing.meta as FileMeta } : undefined,
            signal: controller.signal,
            onProgress: (phase, done, total) => patchUpload(next.id, { state: phase, done, total }),
          });
          patchUpload(next.id, { state: "done" });
          // Done rows leave the queue after 2 s.
          window.setTimeout(() => setUploads((list) => list.filter((u) => u.id !== next.id)), 2000);
          void refresh();
        } catch (error) {
          if ((error as Error).name === "AbortError") continue;
          const message = (error as Error).message;
          // Plan limits get a way to more room instead of a retry.
          if (message === "vault is full") patchUpload(next.id, { state: "failed", error: "Your vault is full", limit: true });
          else if (message === "file too large for your plan") patchUpload(next.id, { state: "failed", error: "Too large for your plan", limit: true });
          else if (message.includes("turned off for your vault")) patchUpload(next.id, { state: "failed", error: "Uploads are turned off" });
          else patchUpload(next.id, { state: "failed", error: "Upload failed" });
        } finally {
          controllers.current.delete(next.id);
        }
      }
    } finally {
      running.current = false;
    }
  }, [patchUpload, refresh]);

  useEffect(() => {
    if (uploads.some((u) => u.state === "waiting")) void pump();
  }, [uploads, pump]);

  const enqueue = useCallback((files: File[], parentId: string | null, existing?: Item) => {
    // New files can only go into your own folders; in a shared one only new versions are allowed.
    const foreign = !existing && !!parentId && !!itemsRef.current.find((i) => i.id === parentId)?.incoming;
    const added = files.map<UploadItem>((file) => ({
      id: crypto.randomUUID(),
      name: existing?.name ?? file.name,
      state: foreign ? "failed" : "waiting",
      error: foreign ? "Shared folders only take new versions" : undefined,
      done: 0,
      total: file.size,
      file,
      parentId,
      existing,
    }));
    setUploads((list) => [...list, ...added]);
  }, []);

  const retryUpload = useCallback((id: string) => patchUpload(id, { state: "waiting", done: 0, error: undefined }), [patchUpload]);

  const clearUploads = useCallback(() => {
    controllers.current.forEach((c) => c.abort());
    setUploads([]);
  }, []);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const value: VaultState = {
    status,
    user,
    // Staff can give a vault its own limit; everything else stays the plan's.
    plan: quota === null ? planOf(planId) : { ...planOf(planId), quota },
    restrictions,
    used,
    autoLockMinutes,
    planSource: record?.planSource ?? "default",
    planUntil: record?.planUntil ?? null,
    retentionUntil: record?.retentionUntil ?? null,
    reloadPlan,
    items,
    byId,
    refresh,
    unlock,
    unlockWithRecovery,
    lock,
    setupPassphrase,
    setSetupPassphrase,
    createVault,
    changePassphrase,
    replaceRecoveryKey,
    setAutoLock,
    keyPair: () => pair.current,
    createFolder,
    updateMeta,
    setTrashed,
    deleteForever,
    uploads,
    enqueue,
    retryUpload,
    clearUploads,
    currentFolder,
    setCurrentFolder,
    query,
    setQuery,
  };

  // The first screen of a visit arrives under the lifting curtain.
  const shownCurtain = curtain === "hold" && status !== "loading" ? "lift" : curtain;

  // Pages render only where the guard allows them, so nothing flashes before a redirect.
  const allowed =
    (status === "setup" && pathname.startsWith("/setup")) ||
    (status === "locked" && pathname === "/unlock") ||
    (status === "unlocked" && !OPEN_PATHS.includes(pathname));

  return (
    <VaultContext.Provider value={value}>
      {allowed && children}
      {shownCurtain && (
        <Curtain
          state={shownCurtain}
          onDone={() => {
            if (shownCurtain === "cover") finishCover();
            else if (shownCurtain === "lift") setCurtain(null);
          }}
        />
      )}
    </VaultContext.Provider>
  );
}

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used inside <VaultProvider>");
  return ctx;
}

/** Number of files directly and indirectly inside a folder. */
export function countFiles(items: Item[], folderId: string): number {
  let n = 0;
  for (const i of items) {
    if (i.parentId !== folderId || i.trashedAt) continue;
    n += i.kind === "file" ? 1 : countFiles(items, i.id);
  }
  return n;
}
