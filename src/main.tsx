import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { LocalizedApp } from "./LocalizedApp";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { disableBrowserShortcuts } from "@/lib/browserKeys";
import { getLang, setLang } from "@/i18n";
import { ipc, isTauri, quickWindow, windowLabel } from "@/lib/ipc";
import { IS_LINUX } from "@/lib/platform";

// Linux (WebKitGTK): lighter effects, see the end of styles/index.css.
if (IS_LINUX) document.documentElement.classList.add("platform-linux");

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing");

if (isTauri()) {
  disableBrowserShortcuts();
  // Errors outside React's render tree (event handlers, promises) end up in the backend log too.
  window.addEventListener("error", (e) => void ipc.log("error", `Uncaught: ${e.message}\n${e.error?.stack ?? ""}`));
  window.addEventListener("unhandledrejection", (e) => void ipc.log("error", `Unhandled rejection: ${String(e.reason)}`));
  void ipc.log("info", "frontend mounted");

  // The language setting is the source of truth (resolved by the backend at first launch: installer choice, else
  // the system's). The last one used is applied before this answer to avoid a flash.
  const syncLanguage = () =>
    void ipc
      .getAppSettings()
      .then((s) => {
        if (s.language) setLang(s.language);
      })
      .catch(() => undefined);
  syncLanguage();
  // The quick prompt window lives as long as the app: pick up a language change each time it opens.
  if (windowLabel() === "quick") void quickWindow.onOpened(syncLanguage);
}
document.documentElement.lang = getLang();

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <LocalizedApp />
    </ErrorBoundary>
  </StrictMode>,
);
