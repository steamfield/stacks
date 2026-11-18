/**
 * Renders the shared app shell and navigation link around the active child route. The route
 * tree uses its outlet for the notes pages.
 */

import { Link, Outlet } from "react-router";

export function Layout() {
  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="shell-title">
          Notes
        </Link>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
