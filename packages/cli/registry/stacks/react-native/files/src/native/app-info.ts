/**
 * The app's side of the AppInfo Turbo Module: the only file that imports a native spec. It
 * enforces the timeout, decodes the native answer and turns every failure into an AppError.
 */
import { z } from "zod";
import NativeAppInfo from "../../modules/app-info/src/NativeAppInfo";
import { AppError, toAppError } from "../errors";

const appInfoSchema = z.object({
  appName: z.string().min(1),
  appVersion: z.string().min(1),
  buildNumber: z.string().min(1),
  systemName: z.string().min(1),
  systemVersion: z.string().min(1),
});

export type AppInfo = z.infer<typeof appInfoSchema>;

/** What the native module provides; null when this build doesn't link it. */
export type AppInfoSource = { getAppInfo(): Promise<unknown> } | null | undefined;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new AppError("timeout", `No answer from AppInfo within ${timeoutMs} ms.`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function readAppInfo(options: {
  timeoutMs: number;
  source?: AppInfoSource;
}): Promise<AppInfo> {
  const { source = NativeAppInfo } = options;
  // TurboModuleRegistry.get returns null or undefined for a module this build doesn't link.
  if (source == null) {
    throw new AppError("unavailable", "The AppInfo native module isn't linked into this build.");
  }
  let raw: unknown;
  try {
    raw = await withTimeout(source.getAppInfo(), options.timeoutMs);
  } catch (error) {
    throw toAppError(error);
  }
  const parsed = appInfoSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("decode", `AppInfo returned an unexpected shape: ${parsed.error.message}`);
  }
  return parsed.data;
}
