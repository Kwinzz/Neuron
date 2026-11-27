import type { MouseEvent, ReactNode } from "react";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { openFolder } from "@/lib/openFolder";
import { toast } from "@/stores/toast";
import { linkTarget } from "./links";

/**
 * A link in Markdown. The webview never navigates: a web link opens in the default browser, a local file opens its
 * folder in the file manager, anything else (relative path, anchor) is shown as a link without action.
 */
export function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
  const target = linkTarget(href);
  if (!target) return <a className="md-link-inert">{children}</a>;

  const open = (e: MouseEvent) => {
    e.preventDefault();
    if (target.kind === "file") {
      void openFolder(target.folder);
      return;
    }
    ipc.openLink(target.url).catch((err: unknown) => {
      toast({ tone: "danger", title: t("common.openLinkFailed"), description: ipcErrorMessage(err) });
    });
  };

  return (
    <a
      href={target.kind === "web" ? target.url : "#"}
      title={target.kind === "web" ? target.url : t("common.openFileFolder", { path: target.path })}
      onClick={open}
      // Middle click would open a browser window inside Neuron.
      onAuxClick={(e) => e.preventDefault()}
    >
      {children}
    </a>
  );
}
