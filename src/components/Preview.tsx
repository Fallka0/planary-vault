"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lock } from "./Icons";
import { fileFamily, formatProgress } from "@/lib/format";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvas: HTMLCanvasElement; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};

export interface Decrypted {
  blob: Blob;
  pages?: number;
  width?: number;
  height?: number;
}

/**
 * Shows a file once it has been decrypted in this browser. `load` fetches and
 * decrypts it (reporting bytes as they arrive); PDFs are drawn with pdf.js,
 * images come from a Blob URL that is revoked when the preview goes away.
 */
export function Preview({
  name,
  mime,
  load,
  onReady,
  compactBar,
}: {
  name: string;
  mime: string;
  load: (onProgress: (done: number, total: number) => void) => Promise<Blob>;
  onReady: (d: Decrypted) => void;
  compactBar?: boolean;
}) {
  const family = fileFamily(name, mime);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [state, setState] = useState<"decrypting" | "ready" | "failed">("decrypting");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [pdf, setPdf] = useState<PdfDoc | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);
  const loadRef = useRef(load);
  useEffect(() => {
    onReadyRef.current = onReady;
    loadRef.current = load;
  });

  // Decrypt, then prepare whatever this type can show.
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    let doc: PdfDoc | null = null;
    (async () => {
      try {
        const blob = await loadRef.current((done, total) => active && setProgress({ done, total }));
        if (!active) return;
        if (family === "image") {
          url = URL.createObjectURL(blob);
          const img = new Image();
          img.src = url;
          await img.decode().catch(() => undefined);
          if (!active) return;
          setImageUrl(url);
          onReadyRef.current({ blob, width: img.naturalWidth || undefined, height: img.naturalHeight || undefined });
        } else if (family === "pdf") {
          const pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
          doc = (await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise) as unknown as PdfDoc;
          if (!active) return void doc.destroy();
          setPdf(doc);
          onReadyRef.current({ blob, pages: doc.numPages });
        } else {
          onReadyRef.current({ blob });
        }
        setState("ready");
      } catch {
        if (active) setState("failed");
      }
    })();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
      void doc?.destroy();
    };
  }, [family]);

  // Draw the current PDF page, fitted to the stage width, sharp on high-DPI screens.
  useEffect(() => {
    if (!pdf || !canvas.current || !stage.current) return;
    let task: { promise: Promise<void>; cancel: () => void } | null = null;
    let cancelled = false;
    void pdf.getPage(page).then((p) => {
      if (cancelled || !canvas.current || !stage.current) return;
      const base = p.getViewport({ scale: 1 });
      const fit = Math.min(720, stage.current.clientWidth - 48) / base.width;
      const ratio = window.devicePixelRatio || 1;
      const viewport = p.getViewport({ scale: fit * zoom * ratio });
      const c = canvas.current;
      c.width = viewport.width;
      c.height = viewport.height;
      c.style.width = `${viewport.width / ratio}px`;
      task = p.render({ canvas: c, viewport });
      task.promise.catch(() => undefined);
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, zoom]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="preview" aria-label="Preview">
      {state === "decrypting" && (
        <div className="preview-center">
          <h2>Decrypting…</h2>
          <div className="progress" role="progressbar" aria-label="Decrypting" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div style={{ width: `${pct}%` }} />
          </div>
          <span className="hint">{progress.total ? formatProgress(progress.done, progress.total) : " "}</span>
        </div>
      )}
      {state === "failed" && (
        <div className="preview-center">
          <h2>Can&apos;t open this file.</h2>
          <span className="hint">It couldn&apos;t be decrypted on this device.</span>
        </div>
      )}
      {state === "ready" && family === "pdf" && (
        <div className="preview-stage" ref={stage}>
          <canvas ref={canvas} className="reveal" aria-label={`Page ${page} of ${pdf?.numPages ?? 1}`} role="img" />
        </div>
      )}
      {state === "ready" && family === "image" && imageUrl && (
        <div className="preview-stage is-image" ref={stage}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a Blob URL of a decrypted file, not an optimisable asset */}
          <img src={imageUrl} alt={name} className="reveal" style={zoom !== 1 ? { maxWidth: "none", width: `${zoom * 100}%` } : undefined} />
        </div>
      )}
      {state === "ready" && family !== "pdf" && family !== "image" && (
        <div className="preview-center">
          <h2>No preview.</h2>
          <span className="hint">Download it to open it on this device.</span>
        </div>
      )}
      <div className="preview-bar">
        <span>
          <Lock />
          {state === "ready" ? "Decrypted on this device" : "Encrypted"}
        </span>
        {state === "ready" && (family === "pdf" || family === "image") && (
          <div className="pager">
            {pdf && (
              <>
                {!compactBar && (
                  <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    <ChevronLeft className="pager-icon" />
                  </button>
                )}
                <span>
                  {page} / {pdf.numPages}
                </span>
                {!compactBar && (
                  <button type="button" aria-label="Next page" disabled={page >= pdf.numPages} onClick={() => setPage((p) => p + 1)}>
                    <ChevronRight className="pager-icon" />
                  </button>
                )}
              </>
            )}
            <span className="zoom" style={{ display: "contents" }}>
              {pdf && <span className="sep" aria-hidden="true" />}
              <button type="button" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => setZoom((z) => Math.round((z - 0.25) * 100) / 100)}>
                −
              </button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom((z) => Math.round((z + 0.25) * 100) / 100)}>
                +
              </button>
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
