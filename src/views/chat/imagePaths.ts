/** Image files an agent can point at in its answer. */
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const MAX_PATHS = 24;

/** Markdown link / image targets: `](path)`, `](<path with spaces>)`, optional title. */
const LINK_TARGET = /\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"\n]*")?\s*\)/g;
/** Inline code spans: `C:\out\fox.png`. */
const CODE_SPAN = /`([^`\n]+)`/g;
/** Bare paths in prose (no spaces): C:\out\fox.png, ./img/a.webp, fox.png. */
const BARE_PATH = /(?:^|[\s(["'])((?:[A-Za-z]:)?[^\s"'()<>[\]`|*]+\.(?:png|jpe?g|gif|webp|bmp|svg|avif))(?=$|[\s)"'\]]|[.,;:!?](?:\s|$))/gim;

function clean(candidate: string): string | null {
  let path = candidate.trim().replace(/^file:\/\/\/?/i, "");
  if (!path || /^(?:https?|data|blob):/i.test(path)) return null;
  try {
    path = decodeURI(path); // markdown links encode spaces as %20
  } catch {
    // keep as is
  }
  return IMAGE_EXT.test(path) ? path : null;
}

/**
 * Local image paths mentioned in an agent message (links, inline code, bare paths), in order of appearance,
 * without duplicates. The backend keeps only the ones that really exist.
 */
export function extractImagePaths(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined) => {
    if (!candidate || found.length >= MAX_PATHS) return;
    const path = clean(candidate);
    if (path && !seen.has(path.toLowerCase())) {
      seen.add(path.toLowerCase());
      found.push(path);
    }
  };
  for (const m of text.matchAll(LINK_TARGET)) add(m[1] ?? m[2]);
  for (const m of text.matchAll(CODE_SPAN)) add(m[1]);
  // A bare name already covered by a longer path (the text of a link to it) is the same file.
  const norm = (p: string) => p.replaceAll("\\", "/").toLowerCase();
  for (const m of text.matchAll(BARE_PATH)) {
    const bare = m[1];
    if (bare && !found.some((f) => norm(f).endsWith(`/${norm(bare)}`))) add(bare);
  }
  return found;
}
