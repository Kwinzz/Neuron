import { File, FileCode, FileImage, FileText, type LucideIcon } from "lucide-react";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "svg",
  "webp",
  "ico",
  "avif",
  "bmp",
]);

const CODE_EXTENSIONS = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "go",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "cs",
  "rb",
  "php",
  "swift",
  "css",
  "scss",
  "html",
  "vue",
  "svelte",
  "sh",
  "ps1",
  "sql",
  "toml",
  "yaml",
  "yml",
  "json",
  "lock",
]);

const TEXT_EXTENSIONS = new Set([
  "md",
  "mdx",
  "txt",
  "rst",
  "pdf",
  "doc",
  "docx",
  "csv",
  "log",
]);

export function fileIcon(name: string): LucideIcon {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return File;
  const ext = name.slice(dot + 1).toLowerCase();
  if (IMAGE_EXTENSIONS.has(ext)) return FileImage;
  if (CODE_EXTENSIONS.has(ext)) return FileCode;
  if (TEXT_EXTENSIONS.has(ext)) return FileText;
  return File;
}
