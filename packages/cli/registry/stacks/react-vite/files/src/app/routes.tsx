/**
 * Defines the shared route tree for the browser and memory routers. It connects the app layout
 * and route error boundary to the items list and detail pages.
 */

import type { RouteObject } from "react-router";
import { ItemPage } from "../features/items/item-page";
import { ItemsPage } from "../features/items/items-page";
import { Layout } from "./layout";
import { RouteError } from "./route-error";

/**
 * Every route in the app. main.tsx mounts them in a browser router; tests mount them in a memory
 * router. An unmatched URL renders RouteError with a 404.
 */
export const routes: RouteObject[] = [
  {
    path: "/",
    Component: Layout,
    ErrorBoundary: RouteError,
    children: [
      { index: true, Component: ItemsPage },
      { path: "items/:id", Component: ItemPage },
    ],
  },
];
