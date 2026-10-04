import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "知点练习 | 每天进步一点点",
  description: "简洁、专注的在线刷题练习工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
