import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Marketing Dashboard",
  description: "Meta Ads × Salesforce revenue and P&L",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
