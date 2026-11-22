import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Provider } from "@/bindings/Provider";
import type { QuotaUnit } from "@/bindings/QuotaUnit";
import type { WindowKind } from "@/bindings/WindowKind";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PopoverHeader, PopoverTitle } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { QUOTA_UNITS, UNIT_LABEL, WINDOW_KINDS, WINDOW_LABEL } from "./quotaFormat";

interface QuotaEditorProps {
  provider: Provider;
  onDone: () => void;
}

export function QuotaEditor({ provider, onDone }: QuotaEditorProps) {
  const id = useId();
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

  const handleKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
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
      onDone();
    } catch (err) {
      setError(ipcErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-3 p-1"
    >
      <PopoverHeader>
        <PopoverTitle>Configurer {provider.label}</PopoverTitle>
      </PopoverHeader>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-label`}>Libellé</Label>
        <Input
          ref={firstInputRef}
          id={`${id}-label`}
          type="text"
          required
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${id}-plan`}>Abonnement</Label>
        <Input
          id={`${id}-plan`}
          type="text"
          value={plan}
          placeholder="Max, Pro, API…"
          onChange={(e) => setPlan(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-window`}>Fenêtre</Label>
          <Select
            value={windowKind}
            onValueChange={(v) => {
              const found = WINDOW_KINDS.find((k) => k === v);
              if (found) setWindowKind(found);
            }}
          >
            <SelectTrigger id={`${id}-window`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WINDOW_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {WINDOW_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-unit`}>Unité</Label>
          <Select
            value={unit}
            onValueChange={(v) => {
              const found = QUOTA_UNITS.find((u) => u === v);
              if (found) setUnit(found);
            }}
          >
            <SelectTrigger id={`${id}-unit`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUOTA_UNITS.map((u) => (
                <SelectItem key={u} value={u}>
                  {UNIT_LABEL[u]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-limit`}>Limite</Label>
          <Input
            id={`${id}-limit`}
            type="number"
            min={0}
            step="any"
            placeholder="Aucune"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="tabular-nums"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${id}-pct`}>Seuil d&apos;alerte (%)</Label>
          <Input
            id={`${id}-pct`}
            type="number"
            min={1}
            max={100}
            step={1}
            required
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="tabular-nums"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="mt-1 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
