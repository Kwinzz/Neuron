import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useEffect,
  useRef,
  useState,
} from "react";
import { cn } from "cn";
import { ArrowRightLeft, MoreHorizontal, Pin } from "lucide-react";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { AgentLogo } from "@/components/ui/AgentLogo";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { StatusDot } from "@/components/ui/StatusDot";
import { t } from "@/i18n";
import { renameChat } from "@/lib/chatActions";
import { deviceOfThread } from "@/lib/deviceRouting";
import { STATUS } from "@/lib/status";
import { useDevices } from "@/stores/devices";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { ChatMenuItems } from "./ChatMenuItems";

export interface ChatRowProps {
  chat: ThreadSummary;
  /** Inside a project folder (`SidebarMenuSubItem` / `SidebarMenuSubButton`). */
  sub?: boolean;
  /** Compact height inside a remote device folder. */
  compact?: boolean;
  /** Muted presentation in the « Archivés » section. */
  muted?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * One sidebar chat row (`<li>`), used in project folders, loose chats, remote devices and archived chats.
 * Supports click to open, double-click / F2 / menu to rename inline, "…" dropdown menu and right-click context menu.
 */
export const ChatRow = memo(function ChatRow({
  chat,
  sub = false,
  compact = false,
  muted = false,
  className,
  style,
}: ChatRowProps) {
  const title = useLive((s) => s.threads[chat.id]?.title ?? chat.title);
  const status = useLive((s) => s.threads[chat.id]?.status ?? chat.status);
  const pinned = useLive((s) => {
    const live = s.threads[chat.id];
    return (live ? live.pinnedAt : chat.pinnedAt) !== null;
  });
  const archived = useLive((s) => {
    const live = s.threads[chat.id];
    return (live ? live.archivedAt : chat.archivedAt) !== null;
  });
  const active = useUi((s) => s.view.kind === "thread" && s.view.id === chat.id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  /** True once the current edit session was committed or cancelled (subsequent blur is a no-op). */
  const settledRef = useRef(false);
  /** Skip Radix's focus restoration on menu close when entering inline rename. */
  const skipCloseFocusRef = useRef(false);
  /** Return focus to the row button when exiting inline rename via Enter or Escape. */
  const restoreButtonFocusRef = useRef(false);

  useEffect(() => {
    if (editing) {
      const input = inputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    } else if (restoreButtonFocusRef.current) {
      restoreButtonFocusRef.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const workspace = useLive((s) => s.threads[chat.id]?.workspace ?? chat.workspace);
  const aiDeviceId = deviceOfThread(chat.id);
  const aiDeviceName = useDevices((s) =>
    aiDeviceId ? (s.devices?.hosts.find((h) => h.nodeId === aiDeviceId)?.name ?? t("shell.unknownDevice")) : t("chat.thisPc"),
  );
  const ownNodeId = useDevices((s) => s.status?.nodeId ?? null);
  const crossDeviceTitle = workspace
    ? t("chat.crossDeviceSummary", {
        ai: aiDeviceName,
        workspace: workspace.deviceId === ownNodeId ? t("chat.thisPc") : workspace.deviceName || t("shell.unknownDevice"),
      })
    : null;
  const label = title || t("common.untitledChat");
  const tooltipLabel = crossDeviceTitle ? `${label} · ${crossDeviceTitle}` : label;
  const working = STATUS[status].active;
  const showPin = pinned && !archived;

  const open = () => useUi.getState().focusThread(chat.id);

  const startEdit = (fromMenu = false) => {
    if (fromMenu) skipCloseFocusRef.current = true;
    settledRef.current = false;
    restoreButtonFocusRef.current = false;
    setDraft(title);
    setEditing(true);
  };

  const commit = async (fromKeyboard = false) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (fromKeyboard) restoreButtonFocusRef.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (!trimmed || trimmed === title) return;
    await renameChat(chat.id, trimmed);
  };

  const cancelEdit = (fromKeyboard = false) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (fromKeyboard) restoreButtonFocusRef.current = true;
    setEditing(false);
  };

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      void commit(true);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancelEdit(true);
    }
  };

  const onRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      startEdit(false);
    }
  };

  const onRowDoubleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    startEdit(false);
  };

  const onMenuCloseAutoFocus = (e: Event) => {
    if (!skipCloseFocusRef.current) return;
    e.preventDefault();
    skipCloseFocusRef.current = false;
    const input = inputRef.current;
    if (input && document.activeElement !== input) {
      input.focus();
      input.select();
    }
  };

  const resetSkipCloseFocus = (menuOpen: boolean) => {
    if (menuOpen) skipCloseFocusRef.current = false;
  };

  const dropdownMenu = !editing && (
    <DropdownMenu onOpenChange={resetSkipCloseFocus}>
      <DropdownMenuTrigger asChild>
        {sub ? (
          <button
            type="button"
            className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground opacity-0 outline-hidden transition-opacity duration-150 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:opacity-100 [&>svg]:size-4"
          >
            <MoreHorizontal />
            <span className="sr-only">{t("chat.chatActions")}</span>
          </button>
        ) : (
          <SidebarMenuAction showOnHover className={compact ? "top-1" : undefined}>
            <MoreHorizontal />
            <span className="sr-only">{t("chat.chatActions")}</span>
          </SidebarMenuAction>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" className="w-52" onCloseAutoFocus={onMenuCloseAutoFocus}>
        <ChatMenuItems kind="dropdown" chat={chat} onRename={() => startEdit(true)} />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const rowItem = sub ? (
    <SidebarMenuSubItem className={className} style={style}>
      {editing ? (
        <div className="flex h-7 min-w-0 -translate-x-px items-center rounded-md bg-sidebar-accent px-1.5 group-data-[collapsible=icon]:hidden">
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            onBlur={() => void commit(false)}
            onClick={(e) => e.stopPropagation()}
            aria-label={t("chat.chatName")}
            className="h-5.5 w-full min-w-0 rounded-sm bg-background px-1.5 text-sm text-sidebar-foreground ring-1 ring-sidebar-ring outline-none"
          />
        </div>
      ) : (
        <>
          {/* On hover the "…" button takes the pin/status slot at the row's right edge. */}
          <SidebarMenuSubButton
            asChild
            isActive={active}
            className={cn(
              "w-full text-left group-focus-within/menu-sub-item:pr-7 group-hover/menu-sub-item:pr-7",
              muted && !active && "text-muted-foreground",
            )}
          >
            <button
              ref={buttonRef}
              type="button"
              onClick={open}
              onDoubleClick={onRowDoubleClick}
              onKeyDown={onRowKeyDown}
              title={tooltipLabel}
            >
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {workspace && (
                <ArrowRightLeft
                  className="size-3! shrink-0 text-muted-foreground! group-focus-within/menu-sub-item:hidden group-hover/menu-sub-item:hidden"
                  aria-hidden
                />
              )}
              {showPin && (
                <>
                  <Pin
                    className="size-3! shrink-0 text-muted-foreground! group-focus-within/menu-sub-item:hidden group-hover/menu-sub-item:hidden"
                    aria-hidden
                  />
                  <span className="sr-only">{t("chat.pinned")}</span>
                </>
              )}
              {working && (
                <StatusDot
                  status={status}
                  className="shrink-0 animate-in fade-in-0 zoom-in-50 duration-200 group-focus-within/menu-sub-item:hidden group-hover/menu-sub-item:hidden"
                />
              )}
            </button>
          </SidebarMenuSubButton>
          {dropdownMenu}
        </>
      )}
    </SidebarMenuSubItem>
  ) : (
    <SidebarMenuItem className={className} style={style}>
      {editing ? (
        <div
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-md bg-sidebar-accent px-2 group-data-[collapsible=icon]:hidden",
            compact ? "h-7" : "h-8",
          )}
        >
          <AgentLogo agent={chat.agent} />
          <input
            ref={inputRef}
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onInputKeyDown}
            onBlur={() => void commit(false)}
            onClick={(e) => e.stopPropagation()}
            aria-label={t("chat.chatName")}
            className="h-6 min-w-0 flex-1 rounded-sm bg-background px-1.5 text-sm text-sidebar-foreground ring-1 ring-sidebar-ring outline-none"
          />
        </div>
      ) : (
        <>
          <SidebarMenuButton
            ref={buttonRef}
            isActive={active}
            onClick={open}
            onDoubleClick={onRowDoubleClick}
            onKeyDown={onRowKeyDown}
            tooltip={tooltipLabel}
            className={cn(
              compact && "h-7",
              showPin && working && "pr-11",
              muted && !active && "text-muted-foreground",
            )}
          >
            <AgentLogo agent={chat.agent} />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {workspace && <ArrowRightLeft className="size-3 shrink-0 text-muted-foreground" aria-hidden />}
            {showPin && <span className="sr-only">{t("chat.pinned")}</span>}
          </SidebarMenuButton>
          {(showPin || working) && (
            <SidebarMenuBadge
              className={cn(
                "gap-1.5 transition-opacity duration-150 group-focus-within/menu-item:opacity-0 group-hover/menu-item:opacity-0",
                compact && "top-1",
              )}
            >
              {showPin && <Pin className="size-3 text-muted-foreground" aria-hidden />}
              {working && <StatusDot status={status} className="animate-in fade-in-0 zoom-in-50 duration-200" />}
            </SidebarMenuBadge>
          )}
          {dropdownMenu}
        </>
      )}
    </SidebarMenuItem>
  );

  return (
    <ContextMenu onOpenChange={resetSkipCloseFocus}>
      <ContextMenuTrigger asChild disabled={editing}>
        {rowItem}
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52" onCloseAutoFocus={onMenuCloseAutoFocus}>
        <ChatMenuItems kind="context" chat={chat} onRename={() => startEdit(true)} />
      </ContextMenuContent>
    </ContextMenu>
  );
});
