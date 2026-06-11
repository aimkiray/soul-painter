import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "灵魂画师 · API 图片生成",
  description: "终端风格 AI 图片生成工具 · 支持文生图、图生图、涂抹编辑",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full overflow-hidden">
      <body className="h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
