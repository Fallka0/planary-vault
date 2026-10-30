"use client";

import { useState } from "react";
import { useVault } from "@/components/VaultProvider";
import { useAuth } from "@/components/AuthProvider";
import { FocusPage } from "@/components/FocusPage";

export default function Unlock() {
  const { unlock, unlockWithRecovery } = useVault();
  const { signOut } = useAuth();
  const [mode, setMode] = useState<"passphrase" | "recovery">("passphrase");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const recovery = mode === "recovery";

  return (
    <FocusPage
      right={
        <button type="button" className="pill pill-outline" onClick={signOut}>
          Sign out
        </button>
      }
    >
      <main className="page-main">
        <div className="stack unlock">
          <h1 className="reveal h-page">Vault is locked.</h1>
          <form
            className="reveal"
            style={{ "--i": 1 } as React.CSSProperties}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!value || busy) return;
              setBusy(true);
              setError("");
              const ok = recovery ? await unlockWithRecovery(value) : await unlock(value);
              if (!ok) {
                setBusy(false);
                setError(recovery ? "That recovery key doesn't open this vault." : "Wrong passphrase.");
              }
            }}
          >
            <label htmlFor="pp" className="sr-only">
              {recovery ? "Recovery key" : "Vault passphrase"}
            </label>
            <div className="pill-input">
              <input
                id="pp"
                key={mode}
                type={recovery ? "text" : "password"}
                autoComplete={recovery ? "off" : "current-password"}
                autoCapitalize={recovery ? "characters" : undefined}
                spellCheck={false}
                placeholder={recovery ? "XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" : "Vault passphrase"}
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-invalid={!!error}
                aria-describedby={error ? "unlock-error" : undefined}
              />
              <button type="submit" className="pill pill-primary" disabled={busy}>
                {busy ? "Unlocking…" : "Unlock"}
              </button>
            </div>
            {error && (
              <p id="unlock-error" className="error-text" role="alert">
                {error}
              </p>
            )}
          </form>
          <button
            type="button"
            className="text-btn"
            onClick={() => {
              setMode(recovery ? "passphrase" : "recovery");
              setValue("");
              setError("");
            }}
          >
            {recovery ? "Use passphrase" : "Use recovery key"}
          </button>
        </div>
      </main>
    </FocusPage>
  );
}
