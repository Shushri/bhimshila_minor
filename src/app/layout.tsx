import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/**
 * IBM Plex — the platform's voice in type. Chosen because it was drawn for
 * exactly this register: dense technical UI, tabular numbers that align in
 * columns, and it stays legible at the 10–12px sizes this board runs on.
 * Self-hosted by next/font at build time, so nothing fetches at runtime and
 * the field build stays offline-safe. Devanagari falls through to the system
 * stack, which every Indian device ships well.
 */
const plex = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BhimShila — disaster intelligence for India",
  description:
    "Ranks every live government disaster alert in India by how many people are under it, " +
    "takes citizen SOS, and coordinates NGO teams. Named for the boulder that split the flood " +
    "at Kedarnath in 2013 — we should not have to rely on luck.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${plex.variable}`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
