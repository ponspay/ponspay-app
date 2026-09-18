import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import "./brand.css";

export const metadata: Metadata = {
  title: "PONSPAY — creator fees, linked to identity",
  description: "PONS launches can link Instagram and TikTok creators before signup. PONSPAY holds their fees in verifiable claim vaults.",
  icons: { icon: "/brand/ponspay-mark.svg", shortcut: "/brand/ponspay-mark.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
      <Script src="https://cdn.getphyllo.com/connect/v2/phyllo-connect.js" strategy="afterInteractive" />
    </html>
  );
}
