import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GL Recon",
  description: "GL reconciliation engine — Next.js, TypeScript, PostgreSQL, Redis"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
