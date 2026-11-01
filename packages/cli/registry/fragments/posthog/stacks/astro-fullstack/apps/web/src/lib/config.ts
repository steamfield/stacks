// The one module that reads PUBLIC_ env (baked in at build time; never a secret).
// An empty PUBLIC_POSTHOG_KEY leaves analytics off.
export const analyticsEnv = {
  key: import.meta.env.PUBLIC_POSTHOG_KEY as string | undefined,
  host: import.meta.env.PUBLIC_POSTHOG_HOST as string | undefined,
};
