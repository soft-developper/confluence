import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

// Share card (confluence:landing-l3): what X, Telegram, Discord and others show for a link
// to confluencebuild.xyz. Built once at build time, in the brand fonts and colours.
export const alt = "Confluence: move USDC in and out of Arc, and pay anyone by @name";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpengraphImage() {
  const fonts = join(process.cwd(), "node_modules/@fontsource/space-grotesk/files");
  const [regular, medium] = await Promise.all([
    readFile(join(fonts, "space-grotesk-latin-400-normal.woff")),
    readFile(join(fonts, "space-grotesk-latin-500-normal.woff")),
  ]);

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#0a121f", color: "#e8edf5", fontFamily: "Space Grotesk", padding: "72px 80px", position: "relative" }}>
        <svg viewBox="75 48 540 666" width="430" height="530" style={{ position: "absolute", right: 70, top: 50 }}>
          <g fill="none" strokeLinecap="round" strokeWidth="64">
            <path d="M115 88C115 190 175 238 245 297C305 348 342 390 342 492" stroke="#2F80EC" />
            <path d="M568 88C568 190 508 240 440 298C380 350 342 392 342 492" stroke="#18B6A7" />
            <path d="M342 498V670" stroke="#5D5AEF" />
          </g>
        </svg>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 500 }}>Confluence</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", fontSize: 66, fontWeight: 500, lineHeight: 1.05, letterSpacing: "-0.02em" }}>
              Move USDC in and out of Arc, and pay anyone by @name.
            </div>
            <div style={{ display: "flex", fontSize: 28, color: "#8fa0b8" }}>Native USDC through Circle&apos;s CCTP. You sign every step.</div>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#8fa0b8" }}>confluencebuild.xyz</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Space Grotesk", data: regular, weight: 400, style: "normal" },
        { name: "Space Grotesk", data: medium, weight: 500, style: "normal" },
      ],
    },
  );
}
