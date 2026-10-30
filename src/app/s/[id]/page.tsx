"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { FocusPage } from "@/components/FocusPage";
import { Download, Lock } from "@/components/Icons";
import { VAULT_API } from "@/lib/api";
import { buildAuthUrl, PRODUCT_URL } from "@/lib/auth";
import { fromB64, importAesKey, openJson } from "@/lib/crypto";
import { downloadLink, saveBlob, type FileMeta } from "@/lib/files";
import { formatBytes, formatProgress } from "@/lib/format";

type State =
  | { kind: "loading" }
  | { kind: "expired" | "gone" | "broken" }
  | { kind: "ok"; meta: FileMeta; key: CryptoKey; needsPassword: boolean };

/**
 * A public share link: vault.planary.ch/s/:id#key. The key never reaches the
 * server; the server only checks expiry, the download limit and the password
 * before it hands out ciphertext.
 */
export default function LinkPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      const fragment = window.location.hash.replace(/^#/, "");
      const res = await fetch(`${VAULT_API}/public/links/${id}`).then((r) => r.json() as Promise<{ status: string; needsPassword?: boolean; encMeta?: string }>);
      if (res.status === "expired" || res.status === "used") return setState({ kind: "expired" });
      if (res.status !== "ok" || !res.encMeta) return setState({ kind: "gone" });
      try {
        const key = await importAesKey(fromB64(fragment));
        const meta = await openJson<FileMeta>(key, res.encMeta);
        setState({ kind: "ok", meta, key, needsPassword: !!res.needsPassword });
      } catch {
        setState({ kind: "broken" });
      }
    })().catch(() => setState({ kind: "gone" }));
  }, [id]);

  const signIn = (
    <button type="button" className="pill pill-primary" style={{ height: 42 }} onClick={() => window.location.assign(buildAuthUrl("login", window.location.origin))}>
      Sign in
    </button>
  );

  if (state.kind === "loading") return <FocusPage right={signIn} home={PRODUCT_URL}>{null}</FocusPage>;

  if (state.kind !== "ok") {
    const headline = state.kind === "expired" ? "Link expired." : state.kind === "broken" ? "Link incomplete." : "Link not found.";
    return (
      <FocusPage right={signIn} home={PRODUCT_URL}>
        <main className="page-main">
          <div className="center-hero">
            <h1 className="h-hero reveal">{headline}</h1>
            <a href={PRODUCT_URL} className="pill pill-outline pill-lg reveal" style={{ "--i": 1 } as React.CSSProperties}>
              What is Vault?
            </a>
          </div>
        </main>
      </FocusPage>
    );
  }

  const { meta, key, needsPassword } = state;
  const pct = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <FocusPage right={signIn} home={PRODUCT_URL}>
      <main className="page-main">
        <form
          className="link-file"
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setProgress({ done: 0, total: 0 });
            try {
              const blob = await downloadLink(id, password, key, meta.mime, (done, total) => setProgress({ done, total }));
              saveBlob(blob, meta.name);
            } catch (err) {
              const status = (err as { status?: number }).status;
              setError(status === 403 ? "Wrong password." : status === 410 ? "This link has expired." : "Download failed. Try again.");
            } finally {
              setProgress(null);
            }
          }}
        >
          <h1 className="h-file reveal">{meta.name}</h1>
          <span className="encrypted reveal" style={{ "--i": 1 } as React.CSSProperties}>
            <Lock />
            {formatBytes(meta.size)} · End-to-end encrypted
          </span>
          {needsPassword && (
            <div className="pill-input reveal" style={{ width: "100%", "--i": 2 } as React.CSSProperties}>
              <label htmlFor="link-pw" className="sr-only">
                Password
              </label>
              <input id="link-pw" type="password" placeholder="Password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          )}
          {progress ? (
            <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
              <div className="progress" style={{ width: "100%" }} role="progressbar" aria-label="Decrypting" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div style={{ width: `${pct}%` }} />
              </div>
              <span className="hint">{progress.total ? formatProgress(progress.done, progress.total) : "Decrypting…"}</span>
            </div>
          ) : (
            <button type="submit" className="pill pill-primary pill-lg reveal" style={{ "--i": 3 } as React.CSSProperties} disabled={needsPassword && !password}>
              <Download />
              Download
            </button>
          )}
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
        </form>
      </main>
    </FocusPage>
  );
}
