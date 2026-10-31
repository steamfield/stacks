export function loader() {
  // A fixed response also keeps the unmatched URL out of framework hydration data.
  throw new Response("Resource not found.", { status: 404 });
}

export default function NotFound() {
  // The thrown response renders the root error boundary.
  return null;
}
