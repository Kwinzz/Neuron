import { defaultUrlTransform } from "react-markdown";

/**
 * A Windows drive path (`C:\…`, `C:/…`), possibly written `/C:/…`, or a `file:` URL. The parser has already
 * percent-encoded the backslashes (`C:%5CUsers…`).
 */
const LOCAL_HREF = /^(?:file:|\/?[A-Za-z]:(?:[\\/]|%5C))/i;

/**
 * react-markdown's URL filter, except local file paths: agents (Codex especially) link the files they touched
 * (`[main.rs](C:\…\main.rs:12)`), which the default filter empties. They never become a navigable href
 * (see `MarkdownLink`).
 */
export function chatUrlTransform(url: string): string {
  return LOCAL_HREF.test(url) ? url : defaultUrlTransform(url);
}

export type LinkTarget = { kind: "web"; url: string } | { kind: "file"; path: string; folder: string } | null;

/** What clicking a link in an answer does: open a web page, open the folder of a local file, or nothing. */
export function linkTarget(href: string | undefined): LinkTarget {
  if (!href) return null;
  if (/^(?:https?|mailto):/i.test(href)) return { kind: "web", url: href };

  let path = href;
  if (/^file:/i.test(path)) {
    try {
      path = new URL(path).pathname;
    } catch {
      return null;
    }
  }
  try {
    path = decodeURIComponent(path);
  } catch {
    // Not percent-encoded: keep it as written.
  }
  path = path
    .replace(/#.*$/, "") // #L12-L20
    .replace(/^\/([A-Za-z]:[\\/])/, "$1") // /C:/… → C:/…
    .replace(/:\d+(?::\d+)?$/, ""); // main.rs:12:5
  const windows = /^[A-Za-z]:[\\/]/.test(path);
  if (!windows && !path.startsWith("/")) return null;
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  // A folder link opens itself; a file link (last segment with an extension) opens its folder.
  const last = path.slice(sep + 1);
  const folder = last.includes(".") && sep > 0 ? path.slice(0, windows && sep === 2 ? 3 : sep) : path;
  return { kind: "file", path, folder };
}
