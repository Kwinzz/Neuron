/**
 * Cross-device chat creation helpers: handles same-device chats as well as chats where the AI runs on one
 * paired device while its file/shell tools operate on another device's workspace.
 */
import type { AgentKind } from "@/bindings/AgentKind";
import type { NewThreadInput } from "@/bindings/NewThreadInput";
import type { NewWorkspaceInput } from "@/bindings/NewWorkspaceInput";
import type { ProjectSummary } from "@/bindings/ProjectSummary";
import type { RemoteCapabilities } from "@/bindings/RemoteCapabilities";
import type { ThreadSummary } from "@/bindings/ThreadSummary";
import { t } from "@/i18n";
import { ipc, remote } from "@/lib/ipc";
import { PLATFORM_OS } from "@/lib/platform";
import { useDevices } from "@/stores/devices";

/** Agents supporting per-session remote MCP workspace execution. */
export function supportsCrossDeviceAgent(agent: AgentKind): boolean {
  return agent === "claude_code" || agent === "codex" || agent === "antigravity";
}

export interface CrossDeviceValidation {
  ok: boolean;
  reason: string | null;
}

/** Checks whether a cross-device pairing (`aiDevice !== workspaceDevice`) is ready to start. */
export function validateCrossDevice(
  agent: AgentKind,
  aiDevice: string | null,
  workspaceDevice: string | null,
  capabilities: Record<string, RemoteCapabilities | null>,
  deviceNameOf: (id: string) => string,
): CrossDeviceValidation {
  if (aiDevice === workspaceDevice) return { ok: true, reason: null };
  if (!supportsCrossDeviceAgent(agent)) {
    return { ok: false, reason: t("chat.crossDeviceUnsupportedAgent") };
  }
  if (aiDevice !== null && aiDevice in capabilities && capabilities[aiDevice] === null) {
    return { ok: false, reason: t("chat.crossDeviceOldHost", { device: deviceNameOf(aiDevice) }) };
  }
  if (workspaceDevice !== null) {
    const caps = capabilities[workspaceDevice];
    if (workspaceDevice in capabilities && caps === null) {
      return { ok: false, reason: t("chat.crossDeviceOldHost", { device: deviceNameOf(workspaceDevice) }) };
    }
    if (caps && !caps.workspaceTools) {
      return { ok: false, reason: t("chat.crossDeviceToolsDisabled", { device: deviceNameOf(workspaceDevice) }) };
    }
  }
  return { ok: true, reason: null };
}

export interface StartChatArgs {
  input: Omit<NewThreadInput, "workspace">;
  /** Device running the AI agent (`null` = this PC). */
  aiDevice: string | null;
  /** Device holding the workspace files (`null` = this PC). */
  workspaceDevice: string | null;
  /** Target project if starting inside one. */
  project?: ProjectSummary | null;
  /** Explicit workspace folder when starting outside a project. */
  workspaceCwd?: string | null;
}

/** Creates a normal or cross-device thread, managing local workspace grants (and rollback on error). */
export async function startChatWithDevices({
  input,
  aiDevice,
  workspaceDevice,
  project = null,
  workspaceCwd = null,
}: StartChatArgs): Promise<ThreadSummary> {
  // Standard same-device chat.
  if (aiDevice === workspaceDevice) {
    return ipc.createThread({ ...input, workspace: null }, aiDevice);
  }

  const devicesState = useDevices.getState();
  let status = devicesState.status;
  if (!status?.nodeId) {
    await devicesState.load();
    status = useDevices.getState().status;
  }

  const resolvedCwd =
    project?.path || workspaceCwd?.trim() || (await ipc.defaultCwd(workspaceDevice));

  let grantId: string | null = null;
  let workspace: NewWorkspaceInput;

  if (workspaceDevice === null) {
    // Direction 2: remote AI host acts on THIS PC over reverse bi-stream with an explicit per-chat grant.
    if (!aiDevice) {
      return ipc.createThread({ ...input, workspace: null }, null);
    }
    const ownNodeId = status?.nodeId;
    if (!ownNodeId) {
      throw new Error("remote node id unavailable");
    }
    const grant = await remote.createGrant(aiDevice, resolvedCwd, "project_only");
    grantId = grant.id;
    workspace = {
      deviceId: ownNodeId,
      deviceName: status?.settings.deviceName || t("chat.thisPc"),
      cwd: resolvedCwd,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      grantId: grant.id,
      os: PLATFORM_OS,
    };
  } else {
    // Direction 1 (or 3rd-device): AI runs locally (or on aiDevice) and targets `workspaceDevice`.
    const host = useDevices.getState().devices?.hosts.find((h) => h.nodeId === workspaceDevice);
    const caps = useDevices.getState().capabilities[workspaceDevice];
    workspace = {
      deviceId: workspaceDevice,
      deviceName: host?.name ?? t("shell.unknownDevice"),
      cwd: resolvedCwd,
      projectId: project?.id ?? null,
      projectName: project?.name ?? null,
      grantId: null,
      os: caps?.os ?? null,
    };
  }

  try {
    const chat = await ipc.createThread(
      {
        ...input,
        cwd: null,
        projectId: null,
        workspace,
      },
      aiDevice,
    );
    if (grantId) {
      void remote.bindGrantThread(grantId, chat.id).catch(() => undefined);
      void useDevices.getState().load();
    }
    return chat;
  } catch (err) {
    if (grantId) {
      void remote.revokeGrant(grantId).catch(() => undefined);
    }
    throw err;
  }
}
