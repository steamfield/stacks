import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from "react-router";
import { createQueryClient } from "./lib/query-client";
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
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Outlet />
    </QueryClientProvider>
  );
}

export function HydrateFallback() {
  return <p role="status">Loading application…</p>;
}

export function ErrorBoundary() {
  const error = useRouteError();
  const message =
    isRouteErrorResponse(error) && error.status === 404 ? "Page not found" : "Something went wrong";
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1>{message}</h1>
      <a href="/">Return home</a>
    </main>
  );
}
