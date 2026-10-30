"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useVault } from "@/components/VaultProvider";
import { useAuth } from "@/components/AuthProvider";
import { FocusPage } from "@/components/FocusPage";
import { ConfirmDialog, Dialog } from "@/components/Dialog";
import { RecoveryKeyPanel } from "@/components/RecoveryKey";
import { ArrowRight } from "@/components/Icons";
import { api, deviceId, type DeviceRecord } from "@/lib/api";
import { ACCOUNT_URL, PRICING_URL } from "@/lib/auth";
import { MIN_PASSPHRASE, newRecoveryKey, passphraseStrength } from "@/lib/crypto";
import { fileFamily, formatBytes, formatSeen, initials } from "@/lib/format";
import { PLANS } from "../../../../shared/plans";

type Section = "account" | "security" | "storage";

export default function Settings() {
  const [section, setSection] = useState<Section>("security");

  return (
    <FocusPage
      right={
        <Link href="/" className="pill pill-outline" style={{ height: 42 }}>
          Back to files
        </Link>
      }
    >
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          <h1 className="h-page reveal" style={{ lineHeight: 1 }}>
            Settings
          </h1>
          <div className="rail">
            {(["account", "security", "storage"] as const).map((s) => (
              <button key={s} type="button" aria-current={section === s ? "page" : undefined} onClick={() => setSection(s)}>
                <span />
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </nav>
        <main key={section} className="settings-main fade-rise">
          {section === "account" && <Account />}
          {section === "security" && <Security />}
          {section === "storage" && <Storage />}
        </main>
      </div>
    </FocusPage>
  );
}

function Account() {
  const { user } = useVault();
  const { signOut } = useAuth();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <section className="account-card">
        <span className="avatar">{initials(user.name || user.email)}</span>
        <div>
          <b>{user.name}</b>
          <span>{user.email}</span>
        </div>
        <a href={ACCOUNT_URL} className="pill pill-outline">
          Planary account
        </a>
      </section>
      <section className="s-outline">
        <span>Delete vault</span>
        <button type="button" className="pill pill-danger" onClick={() => setConfirming(true)}>
          Delete vault
        </button>
      </section>
      {confirming && (
        <ConfirmDialog
          title="Delete vault?"
          body="Every file, version, share and link goes, for good. Your Planary account stays."
          confirm="Delete vault"
          danger
          onConfirm={async () => {
            await api("/vault", { method: "DELETE" });
            signOut();
          }}
          onClose={() => setConfirming(false)}
        />
      )}
    </>
  );
}

function Security() {
  const { autoLockMinutes, setAutoLock, changePassphrase, replaceRecoveryKey, user } = useVault();
  const [changing, setChanging] = useState(false);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DeviceRecord[] | null>(null);
  const self = useMemo(() => deviceId(), []);

  const loadSessions = () => api<{ sessions: DeviceRecord[] }>("/sessions").then((r) => setSessions(r.sessions));
  useEffect(() => {
    void loadSessions();
  }, []);

  return (
    <>
      <section className="s-panel">
        <div className="s-row">
          <span>Vault passphrase</span>
          {!changing && (
            <button type="button" className="pill pill-primary pill-md" onClick={() => setChanging(true)}>
              Change passphrase
            </button>
          )}
          {changing && (
            <ChangePassphrase
              onDone={async (p) => {
                await changePassphrase(p);
                setChanging(false);
              }}
              onCancel={() => setChanging(false)}
            />
          )}
        </div>
        <div className="s-row">
          <span>Recovery key</span>
          <button type="button" className="pill pill-outline pill-md" onClick={() => setNewKey(newRecoveryKey())}>
            Create new key
          </button>
        </div>
        <div className="s-row">
          <label htmlFor="lock">Auto-lock</label>
          <select id="lock" className="select" value={autoLockMinutes} onChange={(e) => void setAutoLock(Number(e.target.value))}>
            <option value={5}>After 5 minutes</option>
            <option value={15}>After 15 minutes</option>
            <option value={60}>After 1 hour</option>
          </select>
        </div>
        <div className="s-row">
          <span>Two-factor authentication</span>
          <a href={ACCOUNT_URL} className="arrow-link">
            Manage
            <ArrowRight />
          </a>
        </div>
      </section>

      <section className="s-block">
        <div className="s-block-head">
          <h2>Active sessions</h2>
          {sessions && sessions.length > 1 && (
            <button
              type="button"
              className="pill pill-outline"
              style={{ height: 36, padding: "0 16px", fontSize: 13 }}
              onClick={async () => {
                await api("/sessions", { method: "DELETE" });
                await loadSessions();
              }}
            >
              Sign out all others
            </button>
          )}
        </div>
        <ul className="s-list">
          {sessions?.map((s) => (
            <li key={s.id}>
              <div>
                <b>{s.agent}</b>
                <span>{[s.place, s.id === self ? "Active now" : formatSeen(s.lastSeen)].filter(Boolean).join(" · ")}</span>
              </div>
              {s.id === self ? (
                <span className="chip chip-sm" style={{ height: 26 }}>
                  This device
                </span>
              ) : (
                <button
                  type="button"
                  className="pill pill-outline pill-sm"
                  onClick={async () => {
                    await api(`/sessions/${s.id}`, { method: "DELETE" });
                    await loadSessions();
                  }}
                >
                  Sign out
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {newKey && (
        <NewRecoveryKey
          value={newKey}
          email={user.email}
          onSave={async () => {
            await replaceRecoveryKey(newKey);
            setNewKey(null);
          }}
          onClose={() => setNewKey(null)}
        />
      )}
    </>
  );
}

function ChangePassphrase({ onDone, onCancel }: { onDone: (p: string) => Promise<void>; onCancel: () => void }) {
  const [pass, setPass] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const strength = passphraseStrength(pass);
  return (
    <form
      className="s-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (pass.length < MIN_PASSPHRASE) return setError(`At least ${MIN_PASSPHRASE} characters.`);
        if (pass !== repeat) return setError("The passphrases don't match.");
        setBusy(true);
        try {
          await onDone(pass);
        } catch {
          setError("Couldn't change it. Try again.");
          setBusy(false);
        }
      }}
    >
      <div className="field">
        <label htmlFor="np">New passphrase</label>
        <input id="np" className="input" type="password" autoComplete="new-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} />
        <div className="strength">
          <div className="strength-bars" aria-hidden="true">
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= strength.bars ? "on" : ""} />
            ))}
          </div>
          <span className="hint">{strength.label}</span>
        </div>
      </div>
      <div className="field">
        <label htmlFor="np2">Repeat passphrase</label>
        <input id="np2" className="input" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} />
      </div>
      {error && <p className="error-text">{error}</p>}
      <div className="actions">
        <button type="submit" className="pill pill-primary" disabled={busy}>
          {busy ? "Saving…" : "Save passphrase"}
        </button>
        <button type="button" className="pill pill-text" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function NewRecoveryKey({ value, email, onSave, onClose }: { value: string; email: string; onSave: () => Promise<void>; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="New recovery key" onClose={onClose}>
      <div className="dialog-body">
        <RecoveryKeyPanel value={value} email={email} />
        <p>Your old key stops working once you use this one.</p>
        <label className="checkbox">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I&apos;ve saved my recovery key
        </label>
        <div className="actions">
          <button
            type="button"
            className="pill pill-primary"
            disabled={!saved || busy}
            onClick={async () => {
              setBusy(true);
              await onSave();
            }}
          >
            Use this key
          </button>
          <button type="button" className="pill pill-text" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Storage() {
  const { used, plan, items } = useVault();
  // The server only knows byte counts; which bytes are images is known here, after decryption.
  const split = useMemo(() => {
    let images = 0;
    let documents = 0;
    let older = 0;
    for (const i of items) {
      if (i.kind !== "file" || i.incoming) continue;
      if (fileFamily(i.name, i.mime) === "image") images += i.currentStoredSize;
      else documents += i.currentStoredSize;
      older += Math.max(0, i.storedSize - i.currentStoredSize);
    }
    return { images, documents, older };
  }, [items]);
  const pct = (n: number) => `${Math.min(100, (n / plan.quota) * 100)}%`;
  const next = plan.id === "free" ? PLANS.plus : plan.id === "plus" ? PLANS.pro : null;
  const usedLabel = formatBytes(used || 0);

  return (
    <>
      <section className="usage">
        <div className="usage-num">
          <b>{used ? usedLabel : "0 GB"}</b>
          <span>of {formatBytes(plan.quota)} used</span>
        </div>
        <div
          className="usage-bar"
          role="img"
          aria-label={`Documents ${formatBytes(split.documents)}, images ${formatBytes(split.images)}, older versions ${formatBytes(split.older)}`}
        >
          <span className="fill-once" style={{ width: pct(split.documents), background: "var(--text)" }} />
          <span className="fill-once" style={{ width: pct(split.images), background: "var(--shared)" }} />
          <span className="fill-once" style={{ width: pct(split.older), background: "var(--faint)" }} />
        </div>
        <div className="usage-legend">
          <span>
            <i style={{ background: "var(--text)" }} />
            Documents {formatBytes(split.documents)}
          </span>
          <span>
            <i style={{ background: "var(--shared)" }} />
            Images {formatBytes(split.images)}
          </span>
          <span>
            <i style={{ background: "var(--faint)" }} />
            Older versions {formatBytes(split.older)}
          </span>
        </div>
      </section>
      <div className="plans">
        <section className="plan">
          <span className="chip">Current plan</span>
          <b>{plan.name}</b>
          <span>
            {formatBytes(plan.quota)} · {plan.monthly ? `CHF ${plan.monthly} per month` : "Free"}
          </span>
        </section>
        {next && (
          <section className="plan plan-light">
            <b>{next.name}</b>
            <span>
              {formatBytes(next.quota)} · CHF {next.monthly} per month
            </span>
            <a href={PRICING_URL} className="pill pill-md">
              See plans
            </a>
          </section>
        )}
      </div>
    </>
  );
}
