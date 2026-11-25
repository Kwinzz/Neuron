import { t } from "@/i18n";
import { ipc, ipcErrorMessage } from "@/lib/ipc";
import { toast } from "@/stores/toast";

/** Open a folder in the system file manager; a toast says why when it can't. */
export async function openFolder(path: string): Promise<void> {
  try {
    await ipc.openFolder(path);
  } catch (err) {
    toast({ tone: "danger", title: t("common.openFolderFailed"), description: ipcErrorMessage(err) });
  }
}
