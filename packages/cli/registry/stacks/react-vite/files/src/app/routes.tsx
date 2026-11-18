/**
 * Defines the shared route tree for the browser and memory routers. It connects the app layout
 * and route error boundary to the notes list and detail pages.
 */

import type { RouteObject } from "react-router";
import { NotePage } from "../features/notes/note-page";
import { NotesPage } from "../features/notes/notes-page";
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
      { index: true, Component: NotesPage },
      { path: "notes/:id", Component: NotePage },
    ],
  },
];
