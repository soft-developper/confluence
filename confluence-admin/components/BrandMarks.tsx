/**
 * The Confluence mark (public/confluence-mark.svg) as a faint decorative watermark. Pure
 * SVG, hidden from screen readers, never clickable, and always behind content.
 */
export function Mark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="75 48 540 666" className={`pointer-events-none ${className}`}>
      <g fill="none" strokeLinecap="round" strokeWidth="64">
        <path d="M115 88C115 190 175 238 245 297C305 348 342 390 342 492" stroke="#2F80EC" />
        <path d="M568 88C568 190 508 240 440 298C380 350 342 392 342 492" stroke="#18B6A7" />
        <path d="M342 498V670" stroke="#5D5AEF" />
      </g>
    </svg>
  );
}

/**
 * Page background: a few large, very faint marks at calm positions, fixed to the viewport
 * so they stay put while you scroll. Cards are opaque, so the marks only show in the
 * margins and never behind text or controls.
 */
export function BackgroundMarks() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <Mark className="absolute -top-16 -left-28 h-[440px] w-auto opacity-[0.045] dark:opacity-[0.06] sm:h-[520px]" />
      <Mark className="absolute top-[38%] -right-36 hidden h-[560px] w-auto opacity-[0.04] dark:opacity-[0.055] md:block" />
      <Mark className="absolute bottom-[-120px] left-[18%] hidden h-[300px] w-auto opacity-[0.035] dark:opacity-[0.05] lg:block" />
    </div>
  );
}
