/**
 * One landing section (confluence:landing-l2): a heading, an optional intro, then content.
 * `band` puts the section on the surface colour, so neighbouring sections read as separate
 * without extra rules or cards.
 */
export function Section({
  id,
  title,
  intro,
  band = false,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  band?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={`scroll-mt-16 ${band ? "border-y border-border bg-surface" : ""}`}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-4 py-16 sm:px-6 sm:py-20 lg:py-24">
        <div className="flex max-w-[40rem] flex-col gap-4">
          <h2 id={`${id}-title`} className="text-[2rem] leading-[1.1] font-medium tracking-[-0.02em] text-balance sm:text-[2.6rem]">
            {title}
          </h2>
          {intro && <p className="text-lg leading-relaxed text-ink-muted">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}
