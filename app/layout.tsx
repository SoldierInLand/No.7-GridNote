import type { Metadata } from "next";
import "./globals.css";

const deploymentHost =
  process.env.VERCEL_PROJECT_PRODUCTION_URL ??
  process.env.VERCEL_URL ??
  "localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(
    deploymentHost.startsWith("localhost")
      ? `http://${deploymentHost}`
      : `https://${deploymentHost}`,
  ),
  title: "Gridnote",
  description:
    "A local-first visual notebook that exports as HTML, CSS, and JavaScript.",
  openGraph: {
    title: "Gridnote",
    description: "Portable notes. Real web files.",
    images: [{ url: "/og.jpg", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gridnote",
    description: "Portable notes. Real web files.",
    images: ["/og.jpg"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
