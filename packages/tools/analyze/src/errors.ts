export type Outcome =
  | { readonly ok: true; readonly written: boolean }
  | { readonly ok: false; readonly kind: "usage" | "input" | "defect"; readonly message: string };

export const EXIT_RECORD_WRITTEN = 0;
export const EXIT_USAGE_OR_INPUT = 2;
export const EXIT_DEFECT = 1;

export function exitCode(outcome: Outcome): number {
  if (outcome.ok) return EXIT_RECORD_WRITTEN;
  switch (outcome.kind) {
    case "usage":
    case "input":
      return EXIT_USAGE_OR_INPUT;
    case "defect":
      return EXIT_DEFECT;
  }
}

export function ok(written: boolean): Outcome {
  return { ok: true, written };
}

export function usageError(message: string): Outcome {
  return { ok: false, kind: "usage", message };
}

export function inputError(message: string): Outcome {
  return { ok: false, kind: "input", message };
}

export function defect(message: string): Outcome {
  return { ok: false, kind: "defect", message };
}
