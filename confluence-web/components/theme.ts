export type ThemeChoice = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "confluence-theme";

/**
 * Runs before first paint (inlined in <head>) so the saved theme applies
 * without a flash. "system" removes the attribute and CSS follows the OS.
 */
export const themeInitScript = `(function(){try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})();`;

export function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage can be unavailable (private mode); the theme still applies for this visit.
  }
}

export function readTheme(): ThemeChoice {
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "light" || t === "dark") return t;
  } catch {
    // fall through
  }
  return "system";
}
