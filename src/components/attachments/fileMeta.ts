import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileText,
  type LucideIcon,
} from "lucide-react";
import { locale, t } from "@/i18n";

const UNITS = ["chat.unitKB", "chat.unitMB", "chat.unitGB"] as const;

const IMAGE_EXTS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "bmp",
  "avif",
  "ico",
]);

const ARCHIVE_EXTS = new Set([
  "zip",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "7z",
  "rar",
]);

const CODE_EXTS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "rs",
  "py",
  "go",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "sh",
  "bash",
  "ps1",
  "toml",
  "yaml",
  "yml",
  "html",
  "css",
  "scss",
  "sql",
  "xml",
  "vue",
  "svelte",
  "lua",
]);

const TEXT_EXTS = new Set([
  "txt",
  "md",
  "markdown",
  "pdf",
  "csv",
  "log",
  "rtf",
]);

/** Format a byte count in the UI language (« 512 o », « 3,4 Ko », « 12 Mo » / « 512 B », « 3.4 KB »). */
export function formatSize(bytes: number): string {
  const fmtInt = new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 });
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${t("chat.unitB")}`;
  const safe = Math.round(bytes);
  if (safe < 1024) return `${fmtInt.format(safe)} ${t("chat.unitB")}`;

  let value = safe / 1024;
  let unitIndex = 0;
  while (
    unitIndex < UNITS.length - 1 &&
    (value >= 1024 || Math.round(value) >= 1024)
  ) {
    value /= 1024;
    unitIndex += 1;
  }

  const unit = t(UNITS[unitIndex] ?? "chat.unitGB");
  const formatted = (value >= 10 ? fmtInt : new Intl.NumberFormat(locale(), { maximumFractionDigits: 1 })).format(value);
  return `${formatted} ${unit}`;
}

/** Extract the lowercase file extension without dot, or "" if none. */
export function fileExtension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot < 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Pick a lucide icon matching the file extension or MIME type. */
export function fileIcon(name: string, mime: string): LucideIcon {
  const ext = fileExtension(name);
  const normalizedMime = mime.toLowerCase().trim();

  if (normalizedMime.startsWith("image/") || IMAGE_EXTS.has(ext)) {
    return FileImage;
  }
  if (ARCHIVE_EXTS.has(ext)) {
    return FileArchive;
  }
  if (CODE_EXTS.has(ext)) {
    return FileCode;
  }
  if (
    TEXT_EXTS.has(ext) ||
    normalizedMime.startsWith("text/") ||
    normalizedMime === "application/pdf"
  ) {
    return FileText;
  }
  return File;
}

function mimeSubtype(mime: string): string {
  const base = (mime.split(";")[0] ?? "").trim().toLowerCase();
  const slash = base.indexOf("/");
  if (slash < 0) return "";
  let sub = base.slice(slash + 1);
  if (!sub || sub === "octet-stream") return "";
  if (sub.startsWith("x-")) sub = sub.slice(2);
  const plus = sub.indexOf("+");
  if (plus > 0) sub = sub.slice(0, plus);
  return sub;
}

/** Short uppercase file type label (« PDF », « PNG », « JPG », « TSX ») or « Fichier » / « File ». */
export function fileTypeLabel(name: string, mime: string): string {
  const ext = fileExtension(name);
  if (ext) {
    if (ext === "jpeg") return "JPG";
    return ext.slice(0, 5).toUpperCase();
  }
  const sub = mimeSubtype(mime);
  if (sub) {
    if (sub === "jpeg") return "JPG";
    return sub.slice(0, 5).toUpperCase();
  }
  return t("chat.fileGeneric");
}
