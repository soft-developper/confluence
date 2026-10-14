import { Mark } from "@/components/BrandMarks";
import { APP_URL, DOCS_URL } from "@/lib/site";

/**
 * Closing call to action (confluence:landing-l3): the mark, one line, the two buttons.
 */
export function FinalCta() {
  return (
    <section aria-labelledby="start-title" className="mx-auto w-full max-w-[1180px] px-4 py-20 sm:px-6 sm:py-28">
      <div className="flex flex-col items-center gap-6 text-center">
        <Mark className="h-16 w-auto" />
        <h2 id="start-title" className="max-w-[36rem] text-[2rem] leading-[1.1] font-medium tracking-[-0.02em] text-balance sm:text-[2.75rem]">
          Bring your USDC to Arc.
        </h2>
        <p className="max-w-[30rem] text-lg text-ink-muted">Connect a wallet, see every fee up front, and sign when you are ready.</p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href={APP_URL}
            className="inline-flex h-12 items-center rounded-md bg-action px-6 text-base font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            Launch app
          </a>
          <a
            href={DOCS_URL}
            className="inline-flex h-12 items-center rounded-md border border-border-control px-6 text-base font-medium hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-text"
          >
            Read the docs
          </a>
        </div>
      </div>
    </section>
  );
}
