import { IBM_Plex_Mono, Instrument_Sans } from "next/font/google";

// Self-hosted at build time by next/font, so the field app never fetches a remote font offline.
export const instrumentSans = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
export const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });
