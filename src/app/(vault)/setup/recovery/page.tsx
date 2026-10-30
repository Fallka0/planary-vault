"use client";

import { useState } from "react";
import Link from "next/link";
import { useVault } from "@/components/VaultProvider";
import { AccountPill, FocusPage } from "@/components/FocusPage";
import { RecoveryKeyPanel } from "@/components/RecoveryKey";
import { newRecoveryKey } from "@/lib/crypto";

export default function SetupRecovery() {
  const { user, setupPassphrase, createVault } = useVault();
  const [recovery] = useState(newRecoveryKey);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <FocusPage right={<AccountPill name={user.name} email={user.email} />}>
      <main className="page-main">
        <div className="stack setup setup-wide">
          <h1 className="h-page reveal">Save your recovery key.</h1>
          <div className="reveal" style={{ "--i": 1, display: "flex", flexDirection: "column", gap: 36 } as React.CSSProperties}>
            <RecoveryKeyPanel value={recovery} email={user.email} />
            <p className="hint" style={{ fontSize: 15 }}>
              Without this key, Planary can&apos;t recover your files.
            </p>
            <label className="checkbox">
              <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
              I&apos;ve saved my recovery key
            </label>
            <div className="actions">
              <button
                type="button"
                className="pill pill-primary pill-lg"
                disabled={!saved || busy || !setupPassphrase}
                onClick={async () => {
                  if (!setupPassphrase) return;
                  setBusy(true);
                  setError("");
                  try {
                    await createVault(setupPassphrase, recovery);
                  } catch {
                    setError("Couldn't create the vault. Try again.");
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Opening…" : "Open my vault"}
              </button>
              <Link href="/setup" className="pill pill-text">
                Back
              </Link>
            </div>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </main>
    </FocusPage>
  );
}
