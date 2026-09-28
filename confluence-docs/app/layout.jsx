import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/geist-mono/400.css";
import "nextra-theme-docs/style.css";
import "./globals.css";

// Confluence docs layout, configured as in https://nextra.site/docs/docs-theme/start (confluence:docs-layout)
const APP_URL = "https://app.confluencebuild.xyz";

export const metadata = {
  metadataBase: new URL("https://docs.confluencebuild.xyz"),
  title: { default: "Confluence Docs", template: "%s | Confluence Docs" },
  description: "How to bridge and swap USDC with Confluence: guides, fees, safety and help.",
  openGraph: { siteName: "Confluence Docs", type: "website" },
};

const logo = (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/confluence-mark.svg" alt="" width={22} height={27} />
    <span style={{ fontWeight: 500, fontSize: 17 }}>Confluence</span>
    <span style={{ fontSize: 13, opacity: 0.6 }}>Docs</span>
  </span>
);

const navbar = (
  <Navbar logo={logo} logoLink="/">
    <a href={APP_URL} className="confluence-open-app">
      Open app
    </a>
  </Navbar>
);

const footer = (
  <Footer>
    <span style={{ fontSize: 14 }}>
      {new Date().getFullYear()} Confluence ·{" "}
      <a href={`${APP_URL}/privacy`}>Privacy</a> · <a href={`${APP_URL}/terms`}>Terms</a> · <a href="mailto:support@confluencebuild.xyz">support@confluencebuild.xyz</a>
    </span>
  </Footer>
);

export default async function RootLayout({ children }) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      {/* Confluence action color #5d5aef as the theme hue */}
      <Head color={{ hue: 241, saturation: 82 }} />
      <body>
        <Layout navbar={navbar} footer={footer} pageMap={await getPageMap()} editLink={null} feedback={{ content: null }} sidebar={{ defaultMenuCollapseLevel: 1 }}>
          {children}
        </Layout>
      </body>
    </html>
  );
}
