"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(
      JSON.stringify({ event: "render.failed", digest: error.digest }),
    );
  }, [error.digest]);
  return (
    <>
      <h1>Could not load this page.</h1>
      <p>Please try again.</p>
      <button type="button" onClick={reset}>
        Try again
      </button>
    </>
  );
}
