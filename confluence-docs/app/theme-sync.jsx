"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "nextra-theme-docs";

/**
 * Shares the docs' theme with the other Confluence sites (confluence:theme-sync). The choice
 * lives in the cookie "confluence-theme" on .confluencebuild.xyz (System, Light or Dark), the
 * same one the app, landing page and admin use. Nextra keeps its own copy in localStorage
 * "theme" (next-themes); THEME_SYNC_HEAD_SCRIPT copies the cookie there before the page draws,
 * and this component keeps both in step afterwards.
 */
const COOKIE = "confluence-theme";
const VALID = ["system", "light", "dark"];
const ONE_YEAR = 60 * 60 * 24 * 365;

export const THEME_SYNC_HEAD_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${COOKIE}=(light|dark|system)(?:;|$)/);if(m)localStorage.setItem("theme",m[1])}catch(e){}})();`;

function readCookie() {
  const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=(light|dark|system)(?:;|$)`));
  return m ? m[1] : null;
}

function writeCookie(choice) {
  const h = window.location.hostname;
  const domain = h === "confluencebuild.xyz" || h.endsWith(".confluencebuild.xyz") ? "; domain=.confluencebuild.xyz" : "";
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE}=${choice}; path=/; max-age=${ONE_YEAR}; samesite=lax${secure}${domain}`;
}

export function ThemeSync() {
  const { theme, setTheme } = useTheme();
  const synced = useRef(false);

  // First run: adopt the shared choice. Afterwards: share changes made with the docs' own switch.
  useEffect(() => {
    if (!theme || !VALID.includes(theme)) return;
    if (!synced.current) {
      synced.current = true;
      const shared = readCookie();
      if (shared && shared !== theme) {
        setTheme(shared);
        return;
      }
    }
    if (readCookie() !== theme) writeCookie(theme);
  }, [theme, setTheme]);

  // A choice made on another Confluence site applies when this tab is shown again.
  useEffect(() => {
    const pull = () => {
      const shared = readCookie();
      if (shared && shared !== theme) setTheme(shared);
    };
    const onVisible = () => document.visibilityState === "visible" && pull();
    window.addEventListener("focus", pull);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", pull);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [theme, setTheme]);

  return null;
}
