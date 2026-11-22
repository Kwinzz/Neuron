export function TimelineSkeleton() {
  return (
    <div className="flex flex-col gap-5 py-2" aria-label="Chargement de l'historique">
      <div className="h-12 w-1/3 self-end rounded-xl bg-surface/60" />

      <div className="flex w-3/4 flex-col gap-2.5">
        <div className="h-3 w-full rounded-sm bg-surface/60" />
        <div className="h-3 w-11/12 rounded-sm bg-surface/60" />
        <div className="h-3 w-2/3 rounded-sm bg-surface/60" />
      </div>

      <div className="h-11 w-full rounded-xl bg-surface/40" />

      <div className="h-10 w-1/4 self-end rounded-xl bg-surface/60" />

      <div className="flex w-4/5 flex-col gap-2.5">
        <div className="h-3 w-full rounded-sm bg-surface/60" />
        <div className="h-3 w-3/5 rounded-sm bg-surface/60" />
      </div>
    </div>
  );
}
