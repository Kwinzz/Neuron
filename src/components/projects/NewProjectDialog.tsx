import { useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import { DevicePicker } from "@/components/chat/DevicePicker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { useDashboard } from "@/stores/dashboard";
import { useNav } from "@/stores/nav";
import { useNewProject } from "@/stores/newProject";
import { toast } from "@/stores/toast";
import { RemoteFolderBrowser } from "./RemoteFolderBrowser";

type Mode = "new" | "existing";

const LOCATION_KEY = "neuron.projectLocation";

/** Last folder a project was created in, per device (null = this PC). */
function readLocation(device: string | null): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "{}") as Record<string, string>;
    return all[device ?? "local"] ?? null;
  } catch {
    return null;
  }
}

function writeLocation(device: string | null, path: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "{}") as Record<string, string>;
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ ...all, [device ?? "local"]: path }));
  } catch {
    /* not remembered */
  }
}

/** `parent` + `name` with the separator `parent` already uses (Windows or Unix paths, any device). */
function joinPath(parent: string, name: string): string {
  const sep = parent.includes("\\") ? "\\" : "/";
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

/** The project just created or added: same path, else the newest one. */
function pickCreated(list: ProjectSummary[], path: string): ProjectSummary | undefined {
  const norm = (p: string) => p.replace(/[\\/]+$/, "").toLowerCase();
  return list.find((p) => norm(p.path) === norm(path)) ?? [...list].sort((a, b) => b.createdAt - a.createdAt)[0];
}

/**
 * « Nouveau projet »: on this PC or a paired device, a new folder (name + location) or an existing folder.
 * This PC uses the native folder picker; a paired device is browsed with `RemoteFolderBrowser`.
 */
export function NewProjectDialog() {
  const open = useNewProject((s) => s.open);
  const presetDevice = useNewProject((s) => s.device);
  const [device, setDevice] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("new");
  const [name, setName] = useState("");
  /** New folder: where it is created. Existing folder: the folder itself. */
  const [location, setLocation] = useState<string | null>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const remote = device !== null;

  // Each opening starts clean on the preset device.
  useEffect(() => {
    if (!open) return;
    setDevice(presetDevice);
    setMode("new");
    setName("");
    setExisting(null);
    setPending(false);
  }, [open, presetDevice]);

  // Location: the last one used on that device, else its home folder.
  useEffect(() => {
    if (!open) return;
    const remembered = readLocation(device);
    setLocation(remembered);
    if (remembered) return;
    let cancelled = false;
    ipc
      .listDirectory(null, device)
      .then((listing) => {
        if (!cancelled) setLocation((current) => current ?? listing.home);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, device]);

  const close = () => {
    if (!pending) useNewProject.getState().close();
  };

  const pickLocal = async (current: string | null, apply: (path: string) => void) => {
    const picked = await ipc.pickDirectory(current ?? undefined);
    if (picked) apply(picked);
  };

  const trimmed = name.trim();
  // On a paired device, the folder shown in the explorer is the one chosen.
  const existingPath = existing ?? (remote ? location : null);
  const target = mode === "new" ? (location && trimmed ? joinPath(location, trimmed) : null) : existingPath;
  const canSubmit = !pending && target !== null;

  const submit = async () => {
    if (!target) return;
    setPending(true);
    try {
      let list: ProjectSummary[];
      if (mode === "new" && location) {
        list = await ipc.createProjectFolder(location, trimmed, device);
        writeLocation(device, location);
      } else {
        list = await ipc.createProject(target, undefined, device);
      }
      const created = pickCreated(list, target);
      await useNav.getState().load();
      if (created) useNav.getState().setProjectOpen(created.id, true);
      if (device) useNav.getState().setDeviceOpen(device, true);
      void useDashboard.getState().load();
      useNewProject.getState().close();
      toast({ tone: "ok", title: t("shell.projectCreated", { name: created?.name ?? trimmed }) });
    } catch (err) {
      toast({ tone: "danger", title: t("shell.projectAddFailed"), description: ipcErrorMessage(err) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("shell.newProjectTitle")}</DialogTitle>
          <DialogDescription>{t("shell.newProjectDescription")}</DialogDescription>
        </DialogHeader>

        <form
          className="flex min-w-0 flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <DevicePicker
            value={device}
            onChange={(next) => {
              setDevice(next);
              setExisting(null);
            }}
            disabled={pending}
          />

          <Tabs value={mode} onValueChange={(v) => setMode(v === "existing" ? "existing" : "new")}>
            <TabsList className="w-full">
              <TabsTrigger value="new">{t("shell.newProjectNewFolder")}</TabsTrigger>
              <TabsTrigger value="existing">{t("shell.newProjectExisting")}</TabsTrigger>
            </TabsList>

            <TabsContent value="new" className="flex min-w-0 flex-col gap-3 pt-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-project-name">{t("shell.newProjectName")}</Label>
                <Input
                  id="new-project-name"
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("shell.newProjectNamePlaceholder")}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label>{t("shell.newProjectLocation")}</Label>
                {remote ? (
                  <RemoteFolderBrowser device={device} path={location} onPathChange={setLocation} />
                ) : (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-2.5 py-1.5 font-mono text-xs text-muted-foreground" title={location ?? ""}>
                      {location ?? "…"}
                    </span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void pickLocal(location, setLocation)}>
                      {t("shell.newProjectBrowse")}
                    </Button>
                  </div>
                )}
              </div>
              {target && (
                <p className="min-w-0 truncate text-xs text-muted-foreground" title={target}>
                  {t("shell.newProjectWillCreate")} <span className="font-mono text-foreground">{target}</span>
                </p>
              )}
            </TabsContent>

            <TabsContent value="existing" className="flex min-w-0 flex-col gap-3 pt-2">
              {remote ? (
                <>
                  <RemoteFolderBrowser device={device} path={existingPath} onPathChange={setExisting} />
                  <p className="text-xs text-muted-foreground">{t("shell.newProjectExistingRemoteHint")}</p>
                </>
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate rounded-md border bg-background/60 px-2.5 py-1.5 font-mono text-xs text-muted-foreground" title={existing ?? ""}>
                    {existing ?? t("shell.newProjectNoFolder")}
                  </span>
                  <Button type="button" variant="outline" size="sm" onClick={() => void pickLocal(existing ?? location, setExisting)}>
                    <FolderOpen className="size-3.5" aria-hidden />
                    {t("shell.newProjectChoose")}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={close}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
              <span>{mode === "new" ? t("shell.newProjectCreate") : t("shell.newProjectAdd")}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
