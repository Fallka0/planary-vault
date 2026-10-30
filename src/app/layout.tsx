import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Planary Vault",
  description: "End-to-end encrypted files. Planary can't read them.",
  icons: {
    icon: [
      { url: "/logo/favicon.svg", type: "image/svg+xml" },
      { url: "/logo/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: "/logo/app-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
