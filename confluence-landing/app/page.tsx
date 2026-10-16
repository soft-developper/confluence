import { SiteHeader } from "@/components/SiteHeader";
import { Hero } from "@/components/Hero";
import { Offer } from "@/components/Offer";
import { HowItWorks } from "@/components/HowItWorks";
import { WhyUs } from "@/components/WhyUs";
import { Security } from "@/components/Security";
import { BuiltWith } from "@/components/BuiltWith";
import { Faq } from "@/components/Faq";
import { FinalCta } from "@/components/FinalCta";
import { SiteFooter } from "@/components/SiteFooter";
import { BackgroundMarks } from "@/components/BrandMarks";
import { getChains, getFooter, getStats } from "@/lib/site";
import { StatsSection } from "@/components/StatsSection";

// Re-read chains and footer from the API every 5 minutes (matches lib/site.ts).
export const revalidate = 300;

export default async function LandingPage() {
  const [chains, footer, stats] = await Promise.all([getChains(), getFooter(), getStats()]);
  return (
    <>
      <BackgroundMarks />
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Hero chains={chains} />
        <StatsSection stats={stats} />
        <Offer />
        <HowItWorks />
        <WhyUs />
        <Security />
        <BuiltWith chains={chains} />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter footer={footer} />
    </>
  );
}
