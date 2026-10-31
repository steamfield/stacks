import type { ReactNode } from "react";
import { config } from "@/lib/server/config";
import "./globals.css";

export function generateMetadata() {
  return { title: config().APP_TITLE };
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
