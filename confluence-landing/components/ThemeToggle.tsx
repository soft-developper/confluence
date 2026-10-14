"use client";

import { useEffect, useState } from "react";
import { applyTheme, readTheme, type ThemeChoice } from "./theme";

const ORDER: ThemeChoice[] = ["system", "light", "dark"];
const LABEL: Record<ThemeChoice, string> = { system: "System", light: "Light", dark: "Dark" };

export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>("system");

  useEffect(() => {
    setChoice(readTheme());
  }, []);

  function next() {
    const n = ORDER[(ORDER.indexOf(choice) + 1) % ORDER.length] ?? "system";
    applyTheme(n);
    setChoice(n);
  }

  return (
    <button
      type="button"
      onClick={next}
      aria-label={`Theme: ${LABEL[choice]}. Change theme`}
      className="h-10 rounded-md border border-border-control px-3 text-sm text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
    >
      Theme: {LABEL[choice]}
    </button>
  );
}
