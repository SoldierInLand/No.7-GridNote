import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gridnote",
  description:
    "A local-first visual notebook that exports as HTML, CSS, and JavaScript.",
  openGraph: {
    title: "Gridnote",
    description: "Portable notes. Real web files.",
    images: [{ url: "/og.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Gridnote",
    description: "Portable notes. Real web files.",
    images: ["/og.png"],
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
