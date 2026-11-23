import { useEffect } from "react";
import { useMemory } from "@/stores/memory";
import { AgentsMcpCard } from "./AgentsMcpCard";

/** Agents & MCP: how each provider reaches Neuron's memory (moved here from the Mémoire view). */
export function AgentsSection() {
  useEffect(() => {
    const memory = useMemory.getState();
    if (!memory.loaded) void memory.load();
    void memory.refreshAgy().catch(() => undefined);
  }, []);
  return <AgentsMcpCard />;
}
