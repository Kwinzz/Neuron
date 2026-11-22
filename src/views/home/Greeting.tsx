import { useNow } from "@/hooks/useNow";

export function Greeting() {
  const now = useNow(60_000);
  const hour = new Date(now).getHours();
  const greeting =
    hour < 5
      ? "Bonsoir"
      : hour < 12
        ? "Bonjour"
        : hour < 18
          ? "Bon après-midi"
          : "Bonsoir";

  return <p className="mt-1 text-[28px] font-bold leading-tight text-fg">{greeting}</p>;
}
