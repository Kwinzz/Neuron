/**
 * Agent CLIs: installed? signed in? (Claude Code, Codex, Antigravity). « Installer » / « Se connecter » open a
 * terminal on the backend side; the store then re-checks the agent every few seconds until it is done.
 */
import { create } from "zustand";
import type { AccessIssue } from "@/bindings/AccessIssue";
import type { AgentAccess } from "@/bindings/AgentAccess";
import type { AgentKind } from "@/bindings/AgentKind";
import { ipc, ipcErrorMessage, isTauri } from "@/lib/ipc";
import { useModels } from "@/stores/models";
import { toast } from "@/stores/toast";
import { t } from "@/i18n";

export type AccessAction = "install" | "login";

/** Agents Neuron installs and signs in to, in the fixed agent order. */
export const MANAGED_AGENTS: readonly AgentKind[] = [
  "claude_code",
  "antigravity",
  "codex",
];

const POLL_MS = 4000;
const POLL_LIMIT_MS = 10 * 60_000;

interface AccessState {
  byAgent: Partial<Record<AgentKind, AgentAccess>>;
  loaded: boolean;
  loading: boolean;
  /** Install / sign-in launched and awaited, per agent. */
  pending: Partial<Record<AgentKind, AccessAction>>;
  load: (refresh?: boolean) => Promise<void>;
  check: (agent: AgentKind) => Promise<AgentAccess | null>;
  start: (agent: AgentKind, action: AccessAction) => Promise<void>;
  cancel: (agent: AgentKind) => void;
}

const inflight = new Map<AgentKind, Promise<AgentAccess | null>>();
const polls = new Map<
  AgentKind,
  { timer: ReturnType<typeof setInterval>; until: number }
>();

function stopPolling(agent: AgentKind) {
  const poll = polls.get(agent);
  if (poll) clearInterval(poll.timer);
  polls.delete(agent);
}

function done(access: AgentAccess, action: AccessAction): boolean {
  return action === "install" ? access.installed : access.loggedIn === true;
}

/** The problem Neuron can fix for this agent, from its last known state. */
export function accessIssue(
  access: AgentAccess | undefined,
): AccessIssue | null {
  if (!access) return null;
  if (!access.installed) return "not_installed";
  if (access.loggedIn === false) return "not_logged_in";
  return null;
}

export const useAccess = create<AccessState>((set, get) => ({
  byAgent: {},
  loaded: false,
  loading: false,
  pending: {},

  load: async (refresh = false) => {
    if (!isTauri() || get().loading) return;
    set({ loading: true });
    try {
      const list = await ipc.agentAccess(refresh);
      const byAgent: Partial<Record<AgentKind, AgentAccess>> = {};
      for (const a of list) byAgent[a.agent] = a;
      set({ byAgent, loaded: true, loading: false });
    } catch {
      set({ loaded: true, loading: false });
    }
  },

  check: (agent) => {
    if (!isTauri()) return Promise.resolve(null);
    // Several error cards of one chat ask at once: a single CLI check per agent.
    const running = inflight.get(agent);
    if (running) return running;
    const request = ipc
      .checkAgentAccess(agent)
      .then((access) => {
        set((s) => ({ byAgent: { ...s.byAgent, [agent]: access } }));
        return access;
      })
      .catch(() => null)
      .finally(() => inflight.delete(agent));
    inflight.set(agent, request);
    return request;
  },

  start: async (agent, action) => {
    try {
      await (action === "install"
        ? ipc.installAgent(agent)
        : ipc.loginAgent(agent));
    } catch (err) {
      toast({
        tone: "danger",
        title:
          action === "install"
            ? t("settings.installFailed")
            : t("settings.signInFailed"),
        description: ipcErrorMessage(err),
      });
      return;
    }
    stopPolling(agent);
    set((s) => ({ pending: { ...s.pending, [agent]: action } }));
    const until = Date.now() + POLL_LIMIT_MS;
    const timer = setInterval(() => {
      void (async () => {
        if (Date.now() > until) {
          get().cancel(agent);
          return;
        }
        const access = await get().check(agent);
        if (!access || !done(access, action) || get().pending[agent] !== action)
          return;
        get().cancel(agent);
        void useModels.getState().load(true);
        if (action === "install" && access.loggedIn !== true) {
          toast({
            tone: "ok",
            title: t("settings.agentInstalled", { agent: access.label }),
            description: t("settings.signInRemaining"),
          });
        } else {
          toast({
            tone: "ok",
            title:
              action === "install"
                ? t("settings.agentInstalled", { agent: access.label })
                : t("settings.agentSignedIn", { agent: access.label }),
            description: access.account ?? undefined,
          });
        }
      })();
    }, POLL_MS);
    polls.set(agent, { timer, until });
  },

  cancel: (agent) => {
    stopPolling(agent);
    set((s) => {
      const pending = { ...s.pending };
      delete pending[agent];
      return { pending };
    });
  },
}));
