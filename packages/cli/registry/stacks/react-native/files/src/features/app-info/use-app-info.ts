/**
 * Loads AppInfo for a screen as loading, error or success state, with a reload for the retry
 * button. A result that arrives after unmount or a newer reload is dropped.
 */
import { useCallback, useEffect, useState } from "react";
import { useServices } from "../../app/services";
import { type AppError, toAppError } from "../../errors";
import { type AppInfo, readAppInfo } from "../../native/app-info";

export type AppInfoState =
  | { status: "loading" }
  | { status: "error"; error: AppError }
  | { status: "success"; info: AppInfo };

export function useAppInfo(): { state: AppInfoState; reload: () => void } {
  const { config, logger } = useServices();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AppInfoState>({ status: "loading" });

  useEffect(() => {
    let current = true;
    setState({ status: "loading" });
    readAppInfo({ timeoutMs: config.nativeTimeoutMs }).then(
      (info) => {
        logger.debug("app_info.loaded", { attempt });
        if (current) setState({ status: "success", info });
      },
      (cause: unknown) => {
        const error = toAppError(cause);
        logger.warn("app_info.failed", { attempt, kind: error.kind, code: error.code ?? null });
        if (current) setState({ status: "error", error });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, config.nativeTimeoutMs, logger]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { state, reload };
}
