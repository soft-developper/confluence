import { SiteHeader } from "@/components/SiteHeader";
import { Hero } from "@/components/Hero";
import { Offer } from "@/components/Offer";
import { HowItWorks } from "@/components/HowItWorks";
import { WhyUs } from "@/components/WhyUs";
import { SiteFooter } from "@/components/SiteFooter";
import { BackgroundMarks } from "@/components/BrandMarks";
import { getChains, getFooter } from "@/lib/site";

// Re-read chains and footer from the API every 5 minutes (matches lib/site.ts).
export const revalidate = 300;

export default async function LandingPage() {
  const [chains, footer] = await Promise.all([getChains(), getFooter()]);
  return (
    <>
      <BackgroundMarks />
      <SiteHeader />
      <main className="flex flex-1 flex-col">
        <Hero chains={chains} />
        <Offer />
        <HowItWorks />
        <WhyUs />
      </main>
      <SiteFooter footer={footer} />
    </>
  );
}
