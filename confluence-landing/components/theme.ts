export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

/**
 * One theme choice shared by every Confluence site (confluence:theme-sync): the app, the
 * landing page, the admin dashboard and the docs. It lives in a cookie on .confluencebuild.xyz,
 * which every subdomain can read, with localStorage as a fallback (local dev, blocked cookies).
 * The html element always carries data-theme="light" or "dark" (System resolves to the device
 * setting and follows it live), and data-theme-choice with the choice itself.
 * Tailwind's dark: variant reads data-theme (see globals.css), as in
 * https://tailwindcss.com/docs/dark-mode#using-a-data-attribute
 */
export const THEME_STORAGE_KEY = "confluence-theme";
export const THEME_COOKIE = "confluence-theme";
const SHARED_DOMAIN = "confluencebuild.xyz";
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Runs before first paint (inlined in <head>) so the saved theme applies without a flash.
 * Keep in sync with readTheme/resolve below; it must stay plain ES5 with no imports.
 */
export const themeInitScript = `(function(){try{var t=null,m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)(?:;|$)/);if(m)t=m[1];if(!t){try{t=localStorage.getItem("${THEME_STORAGE_KEY}")}catch(e){}}if(t!=="light"&&t!=="dark")t="system";var d=t;if(t==="system")d=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.setAttribute("data-theme",d);r.setAttribute("data-theme-choice",t);r.style.colorScheme=d}catch(e){}})();`;

const valid = (v: unknown): v is ThemeChoice => v === "system" || v === "light" || v === "dark";

function cookieDomain(): string {
  const h = window.location.hostname;
  return h === SHARED_DOMAIN || h.endsWith(`.${SHARED_DOMAIN}`) ? `; domain=.${SHARED_DOMAIN}` : "";
}

/** The saved choice: the shared cookie first, then this site's localStorage, else System. */
export function readTheme(): ThemeChoice {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark|system)(?:;|$)`));
    if (m && valid(m[1])) return m[1];
  } catch {
    // cookies unavailable
  }
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (valid(t)) return t;
  } catch {
    // storage unavailable
  }
  return "system";
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Puts a choice on the page (no saving). */
export function paintTheme(choice: ThemeChoice) {
  const resolved = choice === "system" ? systemTheme() : choice;
  const root = document.documentElement;
  root.setAttribute("data-theme", resolved);
  root.setAttribute("data-theme-choice", choice);
  root.style.colorScheme = resolved;
}

/** Saves a choice for every Confluence site and puts it on this page. */
export function applyTheme(choice: ThemeChoice) {
  try {
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie = `${THEME_COOKIE}=${choice}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}${cookieDomain()}`;
  } catch {
    // cookies blocked: localStorage below still keeps it for this site
  }
  try {
    localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // storage unavailable: the theme still applies for this visit
  }
  paintTheme(choice);
}

/**
 * Keeps the page in step: follows the device while the choice is System, and picks up a
 * choice made on another Confluence site when this tab is shown again or gets focus.
 * Returns a cleanup function. `onChange` receives the current choice.
 */
export function watchTheme(onChange: (choice: ThemeChoice) => void): () => void {
  const sync = () => {
    const choice = readTheme();
    paintTheme(choice);
    onChange(choice);
  };
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  const onDevice = () => {
    if (readTheme() === "system") paintTheme("system");
  };
  const onVisible = () => {
    if (document.visibilityState === "visible") sync();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY) sync();
  };
  mq?.addEventListener("change", onDevice);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", sync);
  window.addEventListener("storage", onStorage);
  sync();
  return () => {
    mq?.removeEventListener("change", onDevice);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", sync);
    window.removeEventListener("storage", onStorage);
  };
}
