"use client";

import { useState } from "react";

/** A token or chain logo from Relay's metadata, falling back to its first letter. */
export function TokenIcon({ src, label, size = 24 }: { src: string | undefined; label: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (!src || broken) {
    return (
      <span
        aria-hidden="true"
        style={style}
        className="flex shrink-0 items-center justify-center rounded-full border border-border-control bg-bg text-[11px] font-medium text-ink-muted"
      >
        {label.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="shrink-0 rounded-full bg-bg object-cover"
    />
  );
}
