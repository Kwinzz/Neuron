import App from "./App.tsx";
import { useLocale } from "@/i18n";

/** The app remounts when the language changes: every `t()` call in render then reads the new language. */
export function LocalizedApp() {
  const lang = useLocale((s) => s.lang);
  return <App key={lang} />;
}
