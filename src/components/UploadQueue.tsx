"use client";

import { useVault } from "./VaultProvider";
import { Alert, Check, Close } from "./Icons";
import { formatProgress } from "@/lib/format";

/** Bottom-right queue: Waiting, Encrypting…, Uploading x of y MB, Done, Upload failed + Retry. */
export function UploadQueue() {
  const { uploads, retryUpload, clearUploads } = useVault();
  if (!uploads.length) return null;

  const active = uploads.some((u) => u.state === "waiting" || u.state === "encrypting" || u.state === "uploading");
  const current = uploads.findIndex((u) => u.state === "encrypting" || u.state === "uploading");
  const failed = uploads.filter((u) => u.state === "failed").length;
  const title = active
    ? `Uploading ${current >= 0 ? current + 1 : 1} of ${uploads.length}`
    : failed
      ? failed === 1
        ? "1 upload failed"
        : `${failed} uploads failed`
      : "Uploaded";

  return (
    <div className="queue" role="region" aria-label="Uploads">
      <div className="queue-head">
        <h2 aria-live="polite">{title}</h2>
        <button type="button" className="icon-btn icon-btn-ghost" aria-label={active ? "Cancel uploads" : "Close uploads"} onClick={clearUploads}>
          <Close />
        </button>
      </div>
      <ul>
        {uploads.map((u) => {
          const pct = u.total ? Math.round((u.done / u.total) * 100) : 0;
          if (u.state === "failed") {
            return (
              <li key={u.id} className="is-failed">
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
                  <span className="queue-name">{u.name}</span>
                  <span className="queue-fail">
                    <Alert />
                    {u.error ?? "Upload failed"}
                  </span>
                </div>
                <button type="button" className="pill pill-primary" style={{ height: 34, padding: "0 14px", fontSize: 13 }} onClick={() => retryUpload(u.id)}>
                  Retry
                </button>
              </li>
            );
          }
          if (u.state === "encrypting" || u.state === "uploading") {
            const encrypting = u.state === "encrypting";
            return (
              <li key={u.id} className="is-active">
                <div className="queue-row">
                  <span className="queue-name">{u.name}</span>
                  <span key={u.state} className={`queue-state label-swap${encrypting ? " is-strong" : ""}`}>
                    {encrypting ? "Encrypting…" : formatProgress(u.done, u.total)}
                  </span>
                </div>
                <div
                  className={`progress${encrypting ? " is-muted" : ""}`}
                  role="progressbar"
                  aria-label={encrypting ? "Encrypting" : "Uploading"}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          }
          return (
            <li key={u.id} className={u.state === "waiting" ? "is-waiting" : undefined}>
              <div className="queue-row">
                <span className="queue-name">{u.name}</span>
                {u.state === "done" ? (
                  <span key="done" className="queue-state label-swap">
                    <Check />
                    Done
                  </span>
                ) : (
                  <span className="queue-state">Waiting</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
