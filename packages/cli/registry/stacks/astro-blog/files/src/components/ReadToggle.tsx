import { useState } from "react";

export function ReadToggle() {
  const [read, setRead] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={read}
      onClick={() => setRead(!read)}
      className="mt-8 rounded border px-3 py-2"
    >
      {read ? "Marked as read" : "Mark as read"}
    </button>
  );
}
