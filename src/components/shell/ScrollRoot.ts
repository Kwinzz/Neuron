import { createContext, useContext } from "react";

/** The main scroll container (the `<main>` element of AppShell), for views that manage scrolling. */
export const ScrollRootContext = createContext<HTMLElement | null>(null);

export function useScrollRoot(): HTMLElement | null {
  return useContext(ScrollRootContext);
}
