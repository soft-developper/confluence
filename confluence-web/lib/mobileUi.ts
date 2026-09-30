"use client";

import { useEffect } from "react";

/**
 * Small helpers for phones and tablets (confluence:mobile-layout).
 */

/** True on touch screens (no precise pointer such as a mouse). */
export function isTouchScreen(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

/**
 * Focuses a search field when a sheet opens, but only with a mouse or trackpad. On a touch
 * screen, focusing opens the on-screen keyboard at once and hides half of the list.
 */
export function focusUnlessTouch(el: HTMLElement | null | undefined): void {
  if (el && !isTouchScreen()) el.focus({ preventScroll: true });
}

let locks = 0;
let saved = "";

/**
 * Stops the page behind an open sheet from scrolling (on phones, scrolling a sheet's list
 * otherwise scrolls the page underneath). Nested sheets share one lock.
 */
export function useScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (locks === 0) {
      saved = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    locks++;
    return () => {
      locks = Math.max(0, locks - 1);
      if (locks === 0) document.body.style.overflow = saved;
    };
  }, [active]);
}
