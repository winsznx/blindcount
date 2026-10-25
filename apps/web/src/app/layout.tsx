import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { instrumentSans, plexMono } from "./fonts";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "BlindCount", template: "%s · BlindCount" },
  description: "Field inspections that conceal the pass threshold, preserve the original result and produce independently verifiable reports.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#173B31" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${instrumentSans.variable} ${plexMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
