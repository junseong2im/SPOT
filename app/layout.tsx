import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SPOT. | 우리들의 운동 약속",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "SPOT", statusBarStyle: "default" },
  description: "친구들과 운동 일정을 맞추고, 공통 루틴을 각자에게 맞게 관리하세요.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased">{children}</body>
    </html>
  );
}
