import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { disableBrowserShortcuts } from "@/lib/browserKeys";
import { ipc, isTauri } from "@/lib/ipc";
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
}

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
