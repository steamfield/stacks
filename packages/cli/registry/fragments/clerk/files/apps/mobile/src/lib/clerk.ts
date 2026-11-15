/**
 * Resolves the mobile app's Clerk key and auth bypass. Release builds reject a missing or
 * placeholder publishable key and EXPO_PUBLIC_AUTH_BYPASS=1; development can run anonymous.
 * Placeholder keys match the unfilled values used in EAS profiles and docs.
 */

const PLACEHOLDER = /replace_me|_xxx$/;

/**
 * Whether Clerk is mounted, and with which key. A clone with no key runs
 * anonymous; a release refuses to build without a real key or with the bypass.
 * Expo inlines EXPO_PUBLIC_* only through literal process.env access, so keep
 * these defaults literal.
 */
export function clerkConfig(
  key = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  bypass = process.env.EXPO_PUBLIC_AUTH_BYPASS,
  dev = __DEV__,
) {
  if (!dev && (!key || PLACEHOLDER.test(key))) {
    throw new Error('Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY before building a release.');
  }
  if (!dev && bypass === '1') {
    throw new Error('Unset EXPO_PUBLIC_AUTH_BYPASS before building a release.');
  }
  return key && bypass !== '1'
    ? { enabled: true as const, publishableKey: key }
    : { enabled: false as const };
}
