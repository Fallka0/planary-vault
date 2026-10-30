"use client";

import { useState } from "react";
import { Download } from "./Icons";

/** The 8×4 key tiles with Download (.txt) / Copy / Print. */
export function RecoveryKeyPanel({ value, email }: { value: string; email: string }) {
  const [copied, setCopied] = useState(false);
  const groups = value.split("-");
  const text = `Planary Vault recovery key\n${email}\n\n${value}\n\nWithout this key, Planary can't recover your files.\n`;

  return (
    <div className="panel key-panel">
      <div className="key-grid" aria-label={`Recovery key: ${groups.join(" ")}`} role="group">
        {groups.map((g, i) => (
          <span key={i}>{g}</span>
        ))}
      </div>
      <div className="key-actions">
        <button
          type="button"
          className="pill pill-primary pill-md"
          onClick={() => {
            const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
            const a = document.createElement("a");
            a.href = url;
            a.download = "planary-vault-recovery-key.txt";
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }}
        >
          <Download />
          Download
        </button>
        <button
          type="button"
          className="pill pill-outline pill-md"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <span key={String(copied)} className="label-swap">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
        <button
          type="button"
          className="pill pill-outline pill-md"
          onClick={() => {
            const w = window.open("", "_blank", "width=600,height=500");
            if (!w) return;
            const doc = w.document;
            doc.title = "Planary Vault recovery key";
            const pre = doc.createElement("pre");
            pre.style.font = "20px/1.6 ui-monospace, monospace";
            pre.textContent = text;
            doc.body.appendChild(pre);
            w.focus();
            w.print();
          }}
        >
          Print
        </button>
      </div>
    </div>
  );
}
