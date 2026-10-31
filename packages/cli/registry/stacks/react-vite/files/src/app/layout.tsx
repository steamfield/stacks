import { Link, Outlet } from "react-router";

export function Layout() {
  return (
    <div className="shell">
      <header className="shell-header">
        <Link to="/" className="shell-title">
          Items
        </Link>
      </header>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
