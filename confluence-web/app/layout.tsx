import type { Metadata } from "next";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./globals.css";
import { themeInitScript } from "@/components/theme";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Confluence",
  description: "USDC across chains, centered on Arc.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg text-ink antialiased">
        {/* Providers mount once for the whole app (confluence:single-providers). Mounting them per
            page re-ran wagmi's hydrate on the shared config at every navigation, and each run added
            another copy of every EIP-6963 wallet connector. */}
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
