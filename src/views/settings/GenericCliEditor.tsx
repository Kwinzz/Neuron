import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Loader2, Play, Sparkles } from "lucide-react";
import type { AppSettings } from "@/bindings/AppSettings";
import type { GenericCliProfile } from "@/bindings/GenericCliProfile";
import type { GenericCliTest } from "@/bindings/GenericCliTest";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useModels } from "@/stores/models";
import { useSettings } from "@/stores/settings";
import { toast } from "@/stores/toast";
import { GenericCliCommandPreview } from "./GenericCliCommandPreview";
import {
  GENERIC_CLI_PRESETS,
  parseArgsText,
  type GenericCliPreset,
} from "./genericCliFormat";
import { GenericCliTestResult } from "./GenericCliTestResult";
import { SettingRow } from "./SettingRow";
import { SettingSwitch } from "./SettingSwitch";

interface GenericCliEditorProps {
  settings: AppSettings;
  editingProfile: GenericCliProfile | null;
  editingIndex: number | null;
  onCancel: () => void;
  onSaved: () => void;
}

export function GenericCliEditor({
  settings,
  editingProfile,
  editingIndex,
  onCancel,
  onSaved,
}: GenericCliEditorProps) {
  const tauri = isTauri();
  const [name, setName] = useState(editingProfile?.name ?? "");
  const [command, setCommand] = useState(editingProfile?.command ?? "");
  const [argsText, setArgsText] = useState(() => editingProfile?.args.join("\n") ?? "");
  const [pty, setPty] = useState(editingProfile?.pty ?? false);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<GenericCliTest | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  const parsedArgs = useMemo(() => parseArgsText(argsText), [argsText]);
  const canSave = trimmedName.length > 0 && trimmedCommand.length > 0;

  const applyPreset = (preset: GenericCliPreset) => {
    setName(preset.name);
    setCommand(preset.command);
    setArgsText(preset.args.join("\n"));
    setPty(preset.pty);
    setTestResult(null);
    setTestError(null);
  };

  const handleTest = async () => {
    if (!tauri || !trimmedCommand || testing) return;
    setTesting(true);
    setTestResult(null);
    setTestError(null);
    try {
      const result = await ipc.testGenericCli({
        id: editingProfile?.id || "test",
        name: trimmedName || "Test",
        command: trimmedCommand,
        args: parsedArgs,
        pty,
      });
      setTestResult(result);
    } catch (err: unknown) {
      setTestError(ipcErrorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const base = useSettings.getState().settings ?? settings;
      const draft: GenericCliProfile = {
        id: editingProfile ? editingProfile.id : "",
        name: trimmedName,
        command: trimmedCommand,
        args: parsedArgs,
        pty,
      };
      const nextClis =
        editingIndex !== null && editingIndex >= 0 && editingIndex < base.genericClis.length
          ? base.genericClis.map((item, idx) => (idx === editingIndex ? draft : item))
          : [...base.genericClis, draft];

      await useSettings.getState().save({ ...base, genericClis: nextClis });
      toast({ tone: "ok", title: "CLI enregistré" });
      void useModels.getState().load(true);
      onSaved();
    } catch (err: unknown) {
      toast({
        tone: "danger",
        title: "Impossible d'enregistrer le CLI",
        description: ipcErrorMessage(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    // React events bubble through portals: ignore keys coming from the presets menu.
    if (!(e.target instanceof Node) || !e.currentTarget.contains(e.target)) return;
    if (e.key === "Escape") {
      if (!saving) {
        e.preventDefault();
        onCancel();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (canSave && !saving) {
        e.preventDefault();
        void handleSave();
      }
    }
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className="flex min-w-0 flex-col gap-3 rounded-lg border bg-muted/20 p-3 animate-in fade-in-0 slide-in-from-bottom-1 duration-200"
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <h3 className="truncate text-sm font-medium text-foreground">
          {editingProfile ? `Modifier « ${editingProfile.name} »` : "Nouveau CLI"}
        </h3>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline" size="xs" disabled={saving}>
              <Sparkles aria-hidden />
              <span>Préréglages</span>
              <ChevronDown aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {GENERIC_CLI_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.label}
                onSelect={() => applyPreset(preset)}
                className="justify-between"
              >
                <span>{preset.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{preset.command}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="cli-name">Nom</Label>
          <Input
            ref={nameInputRef}
            id="cli-name"
            value={name}
            disabled={saving}
            placeholder="Ollama"
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="cli-command">Commande</Label>
          <Input
            id="cli-command"
            value={command}
            disabled={saving}
            placeholder="ollama"
            onChange={(e) => setCommand(e.target.value)}
            className="font-mono"
          />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5">
        <Label htmlFor="cli-args">
          <span>Arguments</span>
          <span className="text-xs font-normal text-muted-foreground">(un par ligne)</span>
        </Label>
        <Textarea
          id="cli-args"
          rows={4}
          value={argsText}
          disabled={saving}
          placeholder={"run\nllama3.2\n{prompt}"}
          onChange={(e) => setArgsText(e.target.value)}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
            {"{prompt}"}
          </code>{" "}
          sera remplacé par ton message ; sans{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-foreground">
            {"{prompt}"}
          </code>
          , le message est envoyé sur l&apos;entrée standard.
        </p>
      </div>

      <SettingRow
        id="cli-pty"
        label="Pseudo-terminal"
        description="Pour les outils qui exigent un vrai terminal ; les codes couleur sont retirés."
        disabled={saving}
        control={
          <SettingSwitch
            id="cli-pty"
            checked={pty}
            disabled={saving}
            onCheckedChange={setPty}
            aria-describedby="cli-pty-desc"
          />
        }
      />

      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Aperçu</span>
        <div className="min-w-0 rounded-md border bg-background p-2">
          <GenericCliCommandPreview
            command={trimmedCommand}
            args={parsedArgs}
            showShellPrefix
            showStdinHint
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!tauri || !trimmedCommand || testing || saving}
          title={!tauri ? "Disponible dans l'application" : undefined}
          onClick={() => void handleTest()}
        >
          {testing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Play className="size-3.5" aria-hidden />
          )}
          <span>Tester</span>
        </Button>

        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onCancel}>
            Annuler
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
            disabled={!canSave || saving}
            onClick={() => void handleSave()}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
            <span>Enregistrer</span>
          </Button>
        </div>
      </div>

      {(testResult !== null || testError !== null) && (
        <GenericCliTestResult
          result={testResult}
          error={testError}
          onDismiss={() => {
            setTestResult(null);
            setTestError(null);
          }}
        />
      )}
    </div>
  );
}
