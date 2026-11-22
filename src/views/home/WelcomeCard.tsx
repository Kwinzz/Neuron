import { ArrowRight } from "lucide-react";
import { Card } from "@/components/legacy/Card";
import { Kbd, MOD_LABEL } from "@/components/ui/Kbd";
import { useLive } from "@/stores/live";
import { useUi } from "@/stores/ui";
import { Greeting } from "./Greeting";
import { countActive, countAwaiting } from "./liveCounts";
import { NeuralArt } from "./NeuralArt";

export function WelcomeCard() {
  const activeCount = useLive((s) => countActive(s.threads));
  const awaitingCount = useLive((s) => countAwaiting(s.threads));

  return (
    <Card className="min-h-[260px] overflow-hidden lg:col-span-2 2xl:col-span-1">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 80% at 85% 30%, color-mix(in srgb, var(--color-brand) 35%, transparent), transparent 70%), radial-gradient(40% 60% at 100% 100%, color-mix(in srgb, var(--color-hl-2) 18%, transparent), transparent 70%)",
          }}
        />
        <NeuralArt className="absolute right-0 top-0 h-full w-[60%] max-w-[360px]" />
      </div>

      <div className="relative z-[1] flex h-full flex-1 flex-col">
        <p className="text-sm font-bold text-fg-muted">Bon retour,</p>
        <Greeting />

        <p className="mt-3 max-w-[60%] text-sm text-fg-muted">
          {activeCount === 0 && awaitingCount === 0 ? (
            "Aucun agent en cours. Tout est calme."
          ) : (
            <>
              <span className="font-bold tabular-nums text-fg">{activeCount}</span>{" "}
              {activeCount <= 1 ? "thread en cours" : "threads en cours"} ·{" "}
              <span className="font-bold tabular-nums text-fg">{awaitingCount}</span> en attente
              d&apos;approbation
            </>
          )}
        </p>

        <div className="mt-auto flex items-center gap-3 pt-6">
          <button
            type="button"
            onClick={() => useUi.getState().setPaletteOpen(true)}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-fg transition-colors duration-fast hover:text-hl"
          >
            <span>Ouvrir la palette</span>
            <ArrowRight size={14} />
          </button>
          <div className="inline-flex items-center gap-1">
            <Kbd>{MOD_LABEL}</Kbd>
            <Kbd>K</Kbd>
          </div>
        </div>
      </div>
    </Card>
  );
}
