import type { Metadata } from "next";
import Script from "next/script";
import { IBM_Plex_Mono, Plus_Jakarta_Sans, Sora } from "next/font/google";
import "./globals.css";

const displayFont = Sora({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
});

const bodyFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-body",
});

const monoFont = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

const themeBootstrap = `
  try {
    const savedTheme = window.localStorage.getItem('maf-theme');
    const theme = savedTheme === 'night' ? 'night' : 'daybreak';
    document.documentElement.setAttribute('data-theme', theme);
  } catch (error) {
    document.documentElement.setAttribute('data-theme', 'daybreak');
  }
`;

export const metadata: Metadata = {
  title: "MAF Mission Control",
  description: "A polished control surface for the multi-agent travel planner.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${displayFont.variable} ${bodyFont.variable} ${monoFont.variable}`}
    >
      <body>
        <Script id="theme-bootstrap" strategy="beforeInteractive">
          {themeBootstrap}
        </Script>
        {children}
      </body>
    </html>
  );
}
