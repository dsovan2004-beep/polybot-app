import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PolyBot - AI Trading Dashboard",
  description:
    "AI-powered prediction market trading bot using Claude + GPT-4o + Gemini",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-polybot-dark text-slate-200 antialiased">
        {children}
      </body>
    </html>
  );
}
