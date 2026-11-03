"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Lock } from "./Icons";
import type { Decrypted } from "./Preview";
import { NOTE_MIME, notePage, RichNote } from "./RichNote";
import { useVault, type Item } from "./VaultProvider";
import { downloadNode } from "@/lib/files";
import { formatProgress } from "@/lib/format";

/** Notes are encrypted files; text files under this size open in the editor. */
const EDITABLE = 1024 * 1024;

/** A formatted note made in Vault (an HTML page); other HTML files are not edited here. */
export const isRichNote = (item: Pick<Item, "mime">) => item.mime === NOTE_MIME;

export function isNote(item: Pick<Item, "name" | "mime" | "size">) {
  return (isRichNote(item) || item.mime.startsWith("text/plain") || /\.(txt|md)$/i.test(item.name)) && item.size <= EDITABLE;
}

const titleOf = (name: string) => name.replace(/\.(html?|txt|md)$/i, "");

/**
 * Decrypts a note in this browser and lets it be edited: formatted notes with a toolbar,
 * plain text files as plain text. Saving uploads a new version, encrypted with the file's own
 * key, so older versions stay under Versions. ⌘S / Ctrl+S saves.
 */
export function NoteEditor({ item, canEdit, onReady }: { item: Item; canEdit: boolean; onReady: (d: Decrypted) => void }) {
  const { saveNote } = useVault();
  const rich = isRichNote(item);
  const [state, setState] = useState<"decrypting" | "ready" | "failed">("decrypting");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [initial, setInitial] = useState("");
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const blob = await downloadNode(item.id, item.key, item.mime, undefined, (done, total) => active && setProgress({ done, total }));
        const content = await blob.text();
        if (!active) return;
        setInitial(content);
        setText(content);
        setState("ready");
        onReadyRef.current({ blob });
      } catch {
        if (active) setState("failed");
      }
    })();
    return () => {
      active = false;
    };
  }, [item.id, item.key, item.mime]);

  const save = useCallback(async () => {
    if (!dirty || saving || !canEdit) return;
    setSaving(true);
    setError("");
    try {
      // A formatted note is stored as a whole page, so the download opens in any browser.
      const body = rich ? notePage(titleOf(item.name), text) : text;
      await saveNote(body, { existing: item });
      onReadyRef.current({ blob: new Blob([body], { type: item.mime }) });
      setDirty(false);
    } catch (e) {
      const message = (e as Error).message;
      setError(message.includes("turned off") ? message : message === "vault is full" ? "Your vault is full." : "Couldn't save. Your text is still here; try again.");
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, canEdit, rich, saveNote, text, item]);

  // Leaving with unsaved text asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <section className={`preview note${rich ? " is-rich" : ""}`} aria-label="Note">
      {state === "decrypting" && (
        <div className="preview-center">
          <h2>Decrypting…</h2>
          <span className="hint">{progress.total ? formatProgress(progress.done, progress.total) : " "}</span>
        </div>
      )}
      {state === "failed" && (
        <div className="preview-center">
          <h2>Can&apos;t open this note.</h2>
          <span className="hint">It couldn&apos;t be decrypted on this device.</span>
        </div>
      )}
      {state === "ready" && rich && (
        <RichNote
          initial={initial}
          editable={canEdit}
          onChange={(html) => {
            setText(html);
            setDirty(true);
          }}
          onSave={() => void save()}
        />
      )}
      {state === "ready" && !rich && (
        <textarea
          className="note-text"
          aria-label={`Text of ${item.name}`}
          value={text}
          readOnly={!canEdit}
          placeholder={canEdit ? "Write something. Only you can read it." : ""}
          spellCheck
          autoFocus={canEdit && !initial}
          onChange={(e) => {
            setText(e.target.value);
            setDirty(true);
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
              e.preventDefault();
              void save();
            }
          }}
        />
      )}
      <div className="preview-bar">
        <span>
          <Lock />
          {error ? <span className="error-text">{error}</span> : !canEdit ? "Read only" : saving ? "Encrypting and saving…" : dirty ? "Unsaved changes" : "Saved and encrypted"}
        </span>
        {canEdit && state === "ready" && (
          <button type="button" className="pill pill-primary pill-sm" disabled={!dirty || saving} onClick={() => void save()}>
            Save
          </button>
        )}
      </div>
    </section>
  );
}
