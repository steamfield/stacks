import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>Page not found.</h1>
      <Link href="/">Back to items</Link>
    </>
  );
}
