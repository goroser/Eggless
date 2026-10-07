import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ru } from "@/lib/i18n/ru";

export const metadata: Metadata = {
  title: "Eggless",
  description: "Breakfast cafés with the egg dishes taken out",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-dvh antialiased">
        {children}
        <footer className="px-4 py-6 text-center text-xs text-stone-500">
          {ru.footer}
        </footer>
      </body>
    </html>
  );
}
