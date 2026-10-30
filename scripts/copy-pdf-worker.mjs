// pdf.js renders previews in a web worker. Serving it from /public keeps the bundler out of it.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
mkdirSync("public", { recursive: true });
copyFileSync(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs"), "public/pdf.worker.min.mjs");
