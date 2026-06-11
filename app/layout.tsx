import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export const metadata: Metadata = {
  title: "Soul Painter",
  description: "AI image generation tool supporting text-to-image, image editing, and inpainting",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="fixed inset-0 flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
