import { useEffect } from "react";
import { useMemory } from "@/stores/memory";
import { AgentsMcpCard } from "./AgentsMcpCard";
import { ProvidersCard } from "./ProvidersCard";

/** Agents & MCP: install / sign in to each provider, and how it reaches Neuron's memory. */
export function AgentsSection() {
  useEffect(() => {
    const memory = useMemory.getState();
    if (!memory.loaded) void memory.load();
    void memory.refreshAgy().catch(() => undefined);
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <ProvidersCard />
      <AgentsMcpCard />
    </div>
  );
}
