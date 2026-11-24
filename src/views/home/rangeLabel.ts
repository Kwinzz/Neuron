import type { UsageRange } from "@/bindings/UsageRange";
import { t } from "@/i18n";

/** Getters: the labels follow the interface language. */
export const RANGE_LABEL: Record<UsageRange, string> = {
  get day() {
    return t("home.rangeToday");
  },
  get week() {
    return t("home.rangeLast7");
  },
  get month() {
    return t("home.rangeLast30");
  },
};
