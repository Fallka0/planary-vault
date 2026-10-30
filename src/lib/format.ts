const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const digits = value >= 100 || unit === 0 ? 0 : 1;
  return `${value.toFixed(digits).replace(/\.0$/, "")} ${units[unit]}`;
}

/** "1.3 of 2.1 MB": both numbers in the larger one's unit. */
export function formatProgress(done: number, total: number): string {
  const unit = total >= 1024 ** 3 ? 3 : total >= 1024 ** 2 ? 2 : 1;
  const label = ["B", "KB", "MB", "GB"][unit];
  const f = (n: number) => (n / 1024 ** unit).toFixed(1).replace(/\.0$/, "");
  return `${f(done)} of ${f(total)} ${label}`;
}

const pad = (n: number) => String(n).padStart(2, "0");
const time = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

function dayDiff(d: Date, now = new Date()) {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** File lists: "Today, 08:02", "Yesterday", "21 Oct", "3 Sep 2025". */
export function formatShortDate(ts: number): string {
  const d = new Date(ts);
  const days = dayDiff(d);
  if (days === 0) return `Today, ${time(d)}`;
  if (days === 1) return "Yesterday";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}`;
}

/** Versions and activity: "Today, 08:02", "28 Oct, 17:40". */
export function formatStamp(ts: number): string {
  const d = new Date(ts);
  const days = dayDiff(d);
  if (days === 0) return `Today, ${time(d)}`;
  if (days === 1) return `Yesterday, ${time(d)}`;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${sameYear ? "" : ` ${d.getFullYear()}`}, ${time(d)}`;
}

/** Details: "3 Sep 2026", or "Today, 08:02". */
export function formatLongDate(ts: number): string {
  const d = new Date(ts);
  if (dayDiff(d) === 0) return `Today, ${time(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "15 Nov" */
export function formatDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** Sessions: "Active now", "2 hours ago", "12 Oct". */
export function formatSeen(ts: number): string {
  const minutes = Math.floor((Date.now() - ts) / 60_000);
  if (minutes < 5) return "Active now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return formatDay(ts);
}

export function initials(name: string): string {
  const words = name.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** "PDF", "JPG"… shown in the badge instead of an icon. */
export function typeBadge(name: string): string {
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  return (ext.slice(0, 4) || "FILE").toUpperCase();
}

export type FileFamily = "pdf" | "image" | "document" | "other";

export function fileFamily(name: string, mime = ""): FileFamily {
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (mime.startsWith("image/") || /\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)$/i.test(name)) return "image";
  if (/\.(docx?|xlsx?|pptx?|odt|ods|txt|md|csv|rtf|pages|numbers|key)$/i.test(name) || mime.startsWith("text/")) return "document";
  return "other";
}

/** Details panel "Type" row. */
export function typeLabel(name: string, mime: string, pages?: number): string {
  const badge = typeBadge(name);
  const family = fileFamily(name, mime);
  if (family === "pdf") return pages ? `PDF · ${pages} ${pages === 1 ? "page" : "pages"}` : "PDF";
  if (family === "image") return `${badge} image`;
  return badge;
}
