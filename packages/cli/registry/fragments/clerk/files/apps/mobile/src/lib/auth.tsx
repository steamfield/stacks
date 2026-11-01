import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import type { QueryClient } from '@tanstack/react-query';
import { createContext, type PropsWithChildren, useContext, useEffect, useRef } from 'react';
import { clerkConfig } from './clerk';

type GetToken = () => Promise<string | null>;

const anonymous: GetToken = async () => null;
const TokenContext = createContext<GetToken>(anonymous);

/** The current session token getter: Clerk's when auth is on, null otherwise. */
export function useSessionToken() {
  return useContext(TokenContext);
}

/** Request headers for a fresh token. Clerk rotates tokens, so call this per request. */
export async function authHeaders(getToken: GetToken): Promise<Record<string, string>> {
  const token = await getToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function ClerkSession({ client, children }: PropsWithChildren<{ client: QueryClient }>) {
  const { isLoaded, userId, getToken } = useAuth();
  // undefined until Clerk loads: the first identity is recorded, not a change.
  const previous = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!isLoaded) return;
    const current = userId ?? null;
    // A different identity (sign-out included) must never see the last one's data.
    if (previous.current !== undefined && previous.current !== current) client.clear();
    previous.current = current;
  }, [isLoaded, userId, client]);
  return <TokenContext.Provider value={() => getToken()}>{children}</TokenContext.Provider>;
}

/** Mounts Clerk when a publishable key is set; otherwise the app runs anonymous. */
export function AuthProvider({ client, children }: PropsWithChildren<{ client: QueryClient }>) {
  const config = clerkConfig();
  if (!config.enabled) return children;
  return (
    <ClerkProvider publishableKey={config.publishableKey} tokenCache={tokenCache}>
      <ClerkSession client={client}>{children}</ClerkSession>
    </ClerkProvider>
  );
}
