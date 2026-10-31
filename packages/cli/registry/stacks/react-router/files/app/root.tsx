import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import type { Route } from "~/+types/root";
import { ErrorPage } from "./components/error-page";
import "./app.css";

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body className="bg-stone-50 font-sans text-stone-950">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export const ErrorBoundary = ErrorPage;

// Thrown child Responses render here, so preserve their correlation/cache headers.
export function headers({ parentHeaders, errorHeaders }: Route.HeadersArgs) {
  const result = new Headers(parentHeaders);
  errorHeaders?.forEach((value, key) => {
    result.set(key, value);
  });
  return result;
}
