"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useVault } from "@/components/VaultProvider";
import { AccountPill, FocusPage } from "@/components/FocusPage";
import { Check } from "@/components/Icons";
import { MIN_PASSPHRASE, passphraseStrength } from "@/lib/crypto";

export default function SetupPassphrase() {
  const { user, setupPassphrase, setSetupPassphrase } = useVault();
  const router = useRouter();
  const [pass, setPass] = useState(setupPassphrase ?? "");
  const [repeat, setRepeat] = useState(setupPassphrase ?? "");
  const [tried, setTried] = useState(false);
  const strength = passphraseStrength(pass);
  const longEnough = pass.length >= MIN_PASSPHRASE;
  const matches = repeat.length > 0 && repeat === pass;

  return (
    <FocusPage right={<AccountPill name={user.name} email={user.email} />}>
      <main className="page-main">
        <div className="stack setup">
          <h1 className="h-page reveal">Create a passphrase.</h1>
          <form
            className="reveal"
            style={{ "--i": 1 } as React.CSSProperties}
            onSubmit={(e) => {
              e.preventDefault();
              setTried(true);
              if (!longEnough || !matches) return;
              setSetupPassphrase(pass);
              router.push("/setup/recovery");
            }}
          >
            <div className="field">
              <label htmlFor="pp">Passphrase</label>
              <input
                id="pp"
                className="input"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                aria-describedby="pp-hint"
              />
              <div className="strength" aria-live="polite">
                <div className="strength-bars" aria-hidden="true">
                  {[1, 2, 3, 4].map((n) => (
                    <span key={n} className={n <= strength.bars ? "on" : ""} />
                  ))}
                </div>
                <span className="hint">{strength.label}</span>
              </div>
              <span id="pp-hint" className={tried && !longEnough ? "error-text" : "hint"}>
                At least {MIN_PASSPHRASE} characters.
              </span>
            </div>
            <div className="field">
              <label htmlFor="pp2">Repeat passphrase</label>
              <div className="input-wrap">
                <input
                  id="pp2"
                  className="input"
                  type="password"
                  autoComplete="new-password"
                  value={repeat}
                  onChange={(e) => setRepeat(e.target.value)}
                  aria-invalid={tried && !matches}
                />
                {matches && <Check />}
              </div>
              {tried && !matches && <span className="error-text">The passphrases don&apos;t match.</span>}
            </div>
            <div className="actions">
              <button type="submit" className="pill pill-primary">
                Continue
              </button>
              <span className="hint">Planary can&apos;t reset it.</span>
            </div>
          </form>
        </div>
      </main>
    </FocusPage>
  );
}
