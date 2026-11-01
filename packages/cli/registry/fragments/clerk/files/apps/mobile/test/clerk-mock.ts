// The one stub of Clerk's SDK: its account and network boundary has no answer in
// a test run. test/setup.ts installs it for '@clerk/expo' and its token cache.
import { createElement, Fragment, type PropsWithChildren, useSyncExternalStore } from 'react';

type Session = {
  isLoaded: boolean;
  userId: string | null;
  /** What getToken resolves to; an Error makes it reject. */
  token: string | null | Error;
};

const signedOut: Session = { isLoaded: true, userId: null, token: null };
let session: Session = signedOut;
const listeners = new Set<() => void>();

/** Changes the stubbed session; mounted components re-render as Clerk's would. */
export function setClerkSession(next: Partial<Session>) {
  session = { ...session, ...next };
  for (const listener of listeners) listener();
}

/** Back to loaded and signed out. test/setup.ts calls it after each test. */
export function resetClerkSession() {
  setClerkSession(signedOut);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const clerkExpoMock = {
  ClerkProvider: ({ children }: PropsWithChildren) => createElement(Fragment, null, children),
  useAuth: () => {
    const current = useSyncExternalStore(subscribe, () => session);
    return {
      isLoaded: current.isLoaded,
      isSignedIn: current.isLoaded ? current.userId !== null : undefined,
      userId: current.userId,
      // Reads the live session, as Clerk's getToken does.
      getToken: async () => {
        if (session.token instanceof Error) throw session.token;
        return session.token;
      },
      signOut: async () => setClerkSession({ userId: null, token: null }),
    };
  },
};

export const clerkTokenCacheMock = { tokenCache: undefined };
