import { type FormEvent, type KeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { Provider } from "@/bindings/Provider";
import type { QuotaUnit } from "@/bindings/QuotaUnit";
import type { WindowKind } from "@/bindings/WindowKind";
import { ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { QUOTA_UNITS, UNIT_LABEL, WINDOW_KINDS, WINDOW_LABEL } from "./quotaFormat";

interface QuotaEditorProps {
  provider: Provider;
  onClose: () => void;
  /** The element that toggles the editor: clicks on it are not "outside" (avoids close-then-reopen). */
  anchorRef?: RefObject<HTMLElement | null>;
}

const INPUT_CLASS =
  "h-7 w-full rounded-md border border-line bg-bg-sunken px-2 text-xs text-fg focus:border-line-strong";

export function QuotaEditor({ provider, onClose, anchorRef }: QuotaEditorProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  const [label, setLabel] = useState(provider.label);
  const [plan, setPlan] = useState(provider.plan ?? "");
  const [windowKind, setWindowKind] = useState<WindowKind>(provider.windowKind);
  const [unit, setUnit] = useState<QuotaUnit>(provider.unit);
  const [limit, setLimit] = useState(provider.limitValue != null ? String(provider.limitValue) : "");
  const [pct, setPct] = useState(String(Math.round(provider.alertPct * 100)));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (!(e.target instanceof Node) || !panelRef.current) return;
      if (panelRef.current.contains(e.target) || anchorRef?.current?.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose, anchorRef]);

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmedLabel = label.trim();
    if (!trimmedLabel) {
      setError("Le libellé est requis.");
      return;
    }

    const trimmedLimit = limit.trim();
    let parsedLimit: number | null = null;
    if (trimmedLimit !== "") {
      const n = Number(trimmedLimit);
      if (!Number.isFinite(n) || n < 0) {
        setError("La limite doit être un nombre positif ou nul.");
        return;
      }
      parsedLimit = n;
    }

    const parsedPct = Number(pct);
    if (!Number.isFinite(parsedPct) || parsedPct < 1 || parsedPct > 100) {
      setError("Le seuil d'alerte doit être compris entre 1 et 100 %.");
      return;
    }

    const clampedPct = Math.min(100, Math.max(1, Math.round(parsedPct)));

    setError(null);
    setSaving(true);
    try {
      await useDashboard.getState().updateProvider({
        id: provider.id,
        label: trimmedLabel,
        plan: plan.trim() || null,
        windowKind,
        unit,
        limitValue: parsedLimit,
        alertPct: clampedPct / 100,
      });
      onClose();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={`Configurer ${provider.label}`}
      onKeyDown={handleKeyDown}
      className="pop-in absolute right-0 top-full z-20 mt-1 w-[300px] rounded-lg border border-line-strong bg-surface-raised p-3 shadow-lg"
    >
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-2.5">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">Libellé</span>
          <input
            ref={firstInputRef}
            type="text"
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-fg-muted">Abonnement</span>
          <input
            type="text"
            value={plan}
            placeholder="Max, Pro, API…"
            onChange={(e) => setPlan(e.target.value)}
            className={INPUT_CLASS}
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Fenêtre</span>
            <select
              value={windowKind}
              onChange={(e) => {
                const found = WINDOW_KINDS.find((k) => k === e.target.value);
                if (found) setWindowKind(found);
              }}
              className={INPUT_CLASS}
            >
              {WINDOW_KINDS.map((k) => (
                <option key={k} value={k}>
                  {WINDOW_LABEL[k]}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Unité</span>
            <select
              value={unit}
              onChange={(e) => {
                const found = QUOTA_UNITS.find((u) => u === e.target.value);
                if (found) setUnit(found);
              }}
              className={INPUT_CLASS}
            >
              {QUOTA_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Limite</span>
            <input
              type="number"
              min={0}
              step="any"
              placeholder="Aucune"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-fg-muted">Seuil d&apos;alerte (%)</span>
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              className={`${INPUT_CLASS} font-mono tabular-nums`}
            />
          </label>
        </div>

        {error && <p className="text-[11px] text-danger">{error}</p>}

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="h-7 rounded-md px-2.5 text-xs text-fg-muted transition-colors duration-fast hover:bg-surface-hover hover:text-fg disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="submit"
            disabled={saving}
            className="h-7 rounded-md bg-accent px-2.5 text-xs font-medium text-accent-fg transition-colors duration-fast hover:bg-accent-strong disabled:opacity-50"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </div>
  );
}
