import type { Metadata, Viewport } from "next";
import '@fontsource-variable/inter';
import '@fontsource/ubuntu-mono/400.css';
import '@fontsource/ubuntu-mono/700.css';
import "./globals.css";

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // On-screen keyboards shrink the visual viewport instead of overlaying the
  // fixed composer — keeps the prompt reachable on mobile.
  interactiveWidget: 'resizes-content',
};

export const metadata: Metadata = {
  title: "Soul Painter",
  description: "AI image generation tool supporting text-to-image, image editing, and inpainting",
};

// Blocking boot script: restores data-theme before first paint (zero flash)
// and wires the keyboard-focus flag used to gate input focus rings.
const BOOT_SCRIPT = `try{
var t=localStorage.getItem('imggen-theme-v1');
if(t)document.documentElement.setAttribute('data-theme',t);
}catch(e){}
addEventListener('keydown',function(e){if(e.key==='Tab')document.documentElement.setAttribute('data-keyboard-focus','')});
addEventListener('pointerdown',function(){document.documentElement.removeAttribute('data-keyboard-focus')});`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      </head>
      <body className="fixed inset-0 flex flex-col overflow-hidden">
        {children}
      </body>
    </html>
  );
}
