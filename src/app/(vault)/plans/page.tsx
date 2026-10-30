"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useVault } from "@/components/VaultProvider";
import { FocusPage } from "@/components/FocusPage";
import { ConfirmDialog } from "@/components/Dialog";
import { Check } from "@/components/Icons";
import { api, ApiError, type BillingRecord } from "@/lib/api";
import { BILLING_URL } from "@/lib/auth";
import { formatBytes, formatDay } from "@/lib/format";
import { PLAN_IDS, PLANS, planRank, type Period, type Plan, type PlanId } from "../../../../shared/plans";

const features = (p: Plan) => [
  formatBytes(p.quota),
  `${formatBytes(p.maxFile)} per file`,
  p.versionDays === null ? "All versions, kept" : p.versionDays >= 365 ? "1 year of versions" : `${p.versionDays} days of versions`,
  p.linkDays === null ? "Links without limits" : p.linkDays >= 365 ? "Links up to 1 year" : `Links up to ${p.linkDays} days`,
  ...(p.linkDownloads === null ? [] : p.id === "free" ? [] : [`${p.linkDownloads} downloads per link`]),
];

const periodName = (p: Period) => (p === "year" ? "yearly" : "monthly");

export default function Plans() {
  const { plan, planSource, planUntil, reloadPlan } = useVault();
  const params = useSearchParams();
  const [billing, setBilling] = useState<BillingRecord | null | undefined>(undefined);
  const [period, setPeriod] = useState<Period>("month");
  const [invoice, setInvoice] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [confirmFree, setConfirmFree] = useState(false);

  const load = async () => {
    try {
      const res = await api<{ billing: BillingRecord | null }>("/billing");
      setBilling(res.billing);
      if (res.billing?.period) setPeriod(res.billing.period);
    } catch {
      setBilling(null);
    }
  };

  useEffect(() => {
    let active = true;
    // Back from checkout: the plan may have changed a moment ago.
    const back = params.get("checkout") === "done";
    void (back ? reloadPlan() : Promise.resolve()).then(async () => {
      if (!active) return;
      await load();
      if (back) setNote("Thanks. Your plan is updated.");
    });
    return () => {
      active = false;
    };
    // Runs once per visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError("");
    setNote("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const checkout = (id: Exclude<PlanId, "free">) =>
    run(id, async () => {
      const { url } = await api<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: { plan: id, period, payBy: period === "year" && invoice ? "invoice" : "card" },
      });
      window.location.assign(url);
    });

  const change = (id: Exclude<PlanId, "free">, to: Period) =>
    run(id, async () => {
      const res = await api<{ at: number | null }>("/billing/change", { method: "POST", body: { plan: id, period: to } });
      await Promise.all([reloadPlan(), load()]);
      // A downgrade shows up as the pending notice below; only a change that's already in effect needs saying.
      if (!res.at) setNote(`You're on ${PLANS[id].name}, ${periodName(to)}.`);
    });

  const cancel = () =>
    run("free", async () => {
      // The cancelling notice below says when.
      await api("/billing/cancel", { method: "POST", body: {} });
      await Promise.all([reloadPlan(), load()]);
    });

  const undoCancel = () =>
    run("undo", async () => {
      await api("/billing/cancel/undo", { method: "POST", body: {} });
      await Promise.all([reloadPlan(), load()]);
    });

  const subscribed = !!billing;
  const managedByStaff = planSource === "override";

  const action = (p: Plan) => {
    const isCurrent = p.id === plan.id && (p.id === "free" || !subscribed || billing.period === period);
    if (isCurrent) return <span className="price-current">Current plan</span>;
    if (managedByStaff) return null;
    if (p.id === "free") {
      if (!subscribed || billing.cancelAt) return null;
      return (
        <button type="button" className="pill pill-outline pill-lg" disabled={!!busy} onClick={() => setConfirmFree(true)}>
          Switch to Free
        </button>
      );
    }
    const id = p.id;
    if (!subscribed) {
      return (
        <button type="button" className="pill pill-primary pill-lg" disabled={!!busy} onClick={() => void checkout(id)}>
          {busy === id ? "One moment…" : `Choose ${p.name.replace("Vault ", "")}`}
        </button>
      );
    }
    const label =
      id === billing.current ? `Switch to ${periodName(period)}` : planRank(id) > planRank(billing.current) ? `Upgrade to ${p.name.replace("Vault ", "")}` : `Switch to ${p.name.replace("Vault ", "")}`;
    return (
      <button type="button" className="pill pill-primary pill-lg" disabled={!!busy} onClick={() => void change(id, period)}>
        {busy === id ? "One moment…" : label}
      </button>
    );
  };

  return (
    <FocusPage
      right={
        <Link href="/" className="pill pill-outline" style={{ height: 42 }}>
          Back to files
        </Link>
      }
    >
      <main className="pricing">
        <div className="pricing-head">
          <div>
            <h1 className="h-page reveal">More room for your documents.</h1>
            <p className="hint" style={{ fontSize: 15 }}>
              Every plan is end-to-end encrypted.
            </p>
          </div>
          <div className="pricing-period">
            <div className="seg" role="group" aria-label="Billing period">
              {(["month", "year"] as const).map((p) => (
                <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>
                  {p === "month" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
            <span className="chip chip-outline">2 months free</span>
          </div>
        </div>

        {(note || error) && (
          <p className={error ? "error-text" : "pricing-note"} role={error ? "alert" : "status"}>
            {error || note}
          </p>
        )}
        {managedByStaff && <p className="pricing-note">Your plan was set by Planary. Write to info@planary.ch to change it.</p>}
        {planSource === "overdue" && (
          <p className="pricing-note">
            An invoice is overdue, so Vault Free applies until it&apos;s paid.{" "}
            <a href={BILLING_URL} className="text-link">
              Open invoices
            </a>
          </p>
        )}
        {billing?.cancelAt && (
          <p className="pricing-note">
            {PLANS[billing.current].name} ends {formatDay(billing.cancelAt)}; after that you&apos;re on Vault Free. Nothing is deleted.{" "}
            <button type="button" className="text-link" disabled={!!busy} onClick={() => void undoCancel()}>
              Keep {PLANS[billing.current].name}
            </button>
          </p>
        )}
        {billing?.pending && billing.renewsAt && (
          <p className="pricing-note">
            {PLANS[billing.pending.plan].name}, {periodName(billing.pending.period)}, starts {formatDay(billing.renewsAt)}.{" "}
            <button type="button" className="text-link" disabled={!!busy} onClick={() => void change(billing.current as "plus" | "pro", billing.period!)}>
              Keep {PLANS[billing.current].name}
            </button>
          </p>
        )}

        <div className="price-cards">
          {PLAN_IDS.map((id) => {
            const p = PLANS[id];
            const amount = period === "year" ? p.yearly : p.monthly;
            return (
              <section key={id} className={`price-card${id === "pro" ? " is-featured" : ""}`} aria-label={p.name}>
                <div>
                  <h2>{p.name.replace("Vault ", "")}</h2>
                  <p className="hint">{p.tagline}</p>
                </div>
                <div className="price-amt">
                  <span className="price-cur">CHF</span>
                  <b>{amount}</b>
                  <span className="hint">{id === "free" ? "forever" : period === "year" ? "per year, one invoice" : "per month"}</span>
                </div>
                <ul className="price-list">
                  {features(p).map((f) => (
                    <li key={f}>
                      <Check />
                      {f}
                    </li>
                  ))}
                </ul>
                <div className="price-action">{action(p)}</div>
              </section>
            );
          })}
        </div>

        <div className="pricing-foot">
          {period === "year" && !subscribed && !managedByStaff && (
            <label className="checkbox">
              <input type="checkbox" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} />
              Pay yearly by invoice (QR-bill, 30 days) instead of card
            </label>
          )}
          <p className="hint">
            Prices in CHF. Billed through your Planary account.{" "}
            {subscribed && (
              <>
                {billing.renewsAt && !billing.cancelAt && <>Renews {formatDay(billing.renewsAt)}. </>}
                <a href={BILLING_URL} className="text-link">
                  Invoices and payment
                </a>
              </>
            )}
          </p>
          {planUntil && !billing?.cancelAt && <p className="hint">Your plan ends {formatDay(planUntil)}.</p>}
        </div>
      </main>
      {confirmFree && billing && (
        <ConfirmDialog
          title="Switch to Vault Free?"
          body={`${PLANS[billing.current].name} keeps running until ${billing.renewsAt ? formatDay(billing.renewsAt) : "the end of this period"}. After that, files stay readable and downloadable, but new uploads stop while you're over 10 GB. Older versions are kept by your current plan's rules for 30 more days.`}
          confirm="Switch to Free"
          onConfirm={cancel}
          onClose={() => setConfirmFree(false)}
        />
      )}
    </FocusPage>
  );
}
