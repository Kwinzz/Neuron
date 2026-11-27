import { type ReactNode, useMemo } from "react";
import {
  Archive,
  ArchiveRestore,
  Folder,
  FolderInput,
  FolderMinus,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import {
  ContextMenuItem,
  ContextMenuPortal,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { moveChatToProject, setChatArchived, setChatPinned } from "@/lib/chatActions";
import { deviceOfProject, deviceOfThread } from "@/lib/deviceRouting";
import { openFolder } from "@/lib/openFolder";
import { useChatDeletion } from "@/stores/chatDeletion";
import { useLive } from "@/stores/live";
import { useNav } from "@/stores/nav";

interface MenuItemProps {
  onSelect?: () => void;
  disabled?: boolean;
  variant?: "default" | "destructive";
  className?: string;
  children?: ReactNode;
}

interface MenuPrimitives {
  Item: (props: MenuItemProps) => ReactNode;
  Separator: (props: { className?: string }) => ReactNode;
  Sub: (props: { children?: ReactNode }) => ReactNode;
  SubTrigger: (props: { children?: ReactNode }) => ReactNode;
  Portal: (props: { children?: ReactNode }) => ReactNode;
  SubContent: (props: { className?: string; children?: ReactNode }) => ReactNode;
}

const MENU: Record<"dropdown" | "context", MenuPrimitives> = {
  dropdown: {
    Item: DropdownMenuItem,
    Separator: DropdownMenuSeparator,
    Sub: DropdownMenuSub,
    SubTrigger: DropdownMenuSubTrigger,
    Portal: DropdownMenuPortal,
    SubContent: DropdownMenuSubContent,
  },
  context: {
    Item: ContextMenuItem,
    Separator: ContextMenuSeparator,
    Sub: ContextMenuSub,
    SubTrigger: ContextMenuSubTrigger,
    Portal: ContextMenuPortal,
    SubContent: ContextMenuSubContent,
  },
};

export interface ChatMenuItemsProps {
  kind: "dropdown" | "context";
  chat: ThreadSummary;
  onRename: () => void;
}

/**
 * Shared action items for a sidebar chat row, rendered inside both the "…" dropdown menu and
 * the right-click context menu. Only mounts while a menu is open (Radix Content unmounts when closed).
 */
export function ChatMenuItems({ kind, chat, onRename }: ChatMenuItemsProps) {
  const live = useLive((s) => s.threads[chat.id]);
  const projects = useNav((s) => s.projects);

  const pinned = (live ? live.pinnedAt : chat.pinnedAt) !== null;
  const archived = (live ? live.archivedAt : chat.archivedAt) !== null;
  const currentProjectId = live ? live.projectId : chat.projectId;
  const cwd = live ? live.cwd : chat.cwd;
  const device = deviceOfThread(chat.id) ?? deviceOfProject(currentProjectId);

  const sameDeviceProjects = useMemo(
    () => projects.filter((p) => deviceOfProject(p.id) === device),
    [projects, device],
  );

  const M = MENU[kind];

  return (
    <>
      <M.Item onSelect={onRename}>
        <Pencil />
        <span>{t("chat.rename")}</span>
      </M.Item>

      <M.Item onSelect={() => void setChatPinned(chat.id, !pinned)}>
        {pinned ? <PinOff /> : <Pin />}
        <span>{t(pinned ? "chat.unpin" : "chat.pin")}</span>
      </M.Item>

      <M.Item onSelect={() => void setChatArchived(chat.id, !archived)}>
        {archived ? <ArchiveRestore /> : <Archive />}
        <span>{t(archived ? "chat.unarchive" : "chat.archive")}</span>
      </M.Item>

      <M.Sub>
        <M.SubTrigger>
          <FolderInput />
          <span>{t("chat.moveToProject")}</span>
        </M.SubTrigger>
        <M.Portal>
          <M.SubContent className="max-h-72 w-52 overflow-y-auto">
            {sameDeviceProjects.map((project) => (
              <M.Item
                key={project.id}
                disabled={currentProjectId === project.id}
                onSelect={() => void moveChatToProject(chat.id, project.id)}
              >
                <Folder />
                <span className="truncate">{project.name}</span>
              </M.Item>
            ))}
            {sameDeviceProjects.length > 0 && <M.Separator />}
            <M.Item
              disabled={currentProjectId === null}
              onSelect={() => void moveChatToProject(chat.id, null)}
            >
              <FolderMinus />
              <span>{t("chat.noProject")}</span>
            </M.Item>
          </M.SubContent>
        </M.Portal>
      </M.Sub>

      {cwd && !device && (
        <M.Item onSelect={() => void openFolder(cwd)}>
          <FolderOpen />
          <span>{t("common.openFolder")}</span>
        </M.Item>
      )}

      <M.Separator />

      <M.Item variant="destructive" onSelect={() => useChatDeletion.getState().request(chat.id)}>
        <Trash2 />
        <span>{t("chat.deleteChat")}</span>
      </M.Item>
    </>
  );
}
