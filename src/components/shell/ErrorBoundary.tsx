import { Component, type ErrorInfo, type ReactNode } from "react";
import { ipc } from "@/lib/ipc";

interface State {
  error: Error | null;
}

/** Last line of defence: show the error instead of an empty window, and log it to the backend. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    void ipc.log("error", `React render error: ${error.message}\n${error.stack ?? ""}\n${info.componentStack ?? ""}`);
  }

  override render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <main className="flex h-full items-center justify-center p-8">
        <div className="flex max-w-2xl flex-col gap-4 rounded-xl border bg-card p-6 text-card-foreground">
          <h1 className="text-lg font-semibold">Neuron a rencontré une erreur d'affichage</h1>
          <pre className="max-h-[50vh] overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
            {error.message}
            {"\n\n"}
            {error.stack}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="self-start rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Recharger
          </button>
        </div>
      </main>
    );
  }
}
