import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react-native';
import { AuthProvider, authHeaders, useSessionToken } from '../src/lib/auth';
import { clerkConfig } from '../src/lib/clerk';
import { resetClerkSession, setClerkSession } from './clerk-mock';

// Also installed by test/setup.ts; repeated so this file stands on its own.
jest.mock('@clerk/expo', () => require('./clerk-mock').clerkExpoMock);
jest.mock('@clerk/expo/token-cache', () => require('./clerk-mock').clerkTokenCacheMock);

const KEY = 'pk_test_local';
let getToken: ReturnType<typeof useSessionToken> = async () => 'unset';
function Probe() {
  getToken = useSessionToken();
  return null;
}
async function mount(client = new QueryClient()) {
  const view = await render(
    <QueryClientProvider client={client}>
      <AuthProvider client={client}>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { client, view };
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = KEY;
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  resetClerkSession();
});

test('a release refuses a missing or placeholder key and the bypass', () => {
  expect(clerkConfig('', undefined, true)).toEqual({ enabled: false });
  expect(clerkConfig(KEY, '1', true)).toEqual({ enabled: false });
  expect(clerkConfig(KEY, undefined, false)).toEqual({ enabled: true, publishableKey: KEY });
  for (const key of ['', 'pk_test_replace_me', 'pk_live_xxx']) {
    expect(() => clerkConfig(key, undefined, false)).toThrow('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY');
  }
  expect(() => clerkConfig(KEY, '1', false)).toThrow('EXPO_PUBLIC_AUTH_BYPASS');
});
test('without a key no token is ever sent, whatever Clerk holds', async () => {
  delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
  setClerkSession({ userId: 'user_1', token: 'never_sent' });
  const { view } = await mount();
  expect(await authHeaders(getToken)).toEqual({});
  await view.unmount();
});
test('signed out sends no Authorization; signed in sends the current token', async () => {
  const { view } = await mount();
  expect(await authHeaders(getToken)).toEqual({});
  await act(async () => setClerkSession({ userId: 'user_1', token: 'tok_1' }));
  expect(await authHeaders(getToken)).toEqual({ authorization: 'Bearer tok_1' });
  await act(async () => setClerkSession({ token: 'tok_2' }));
  expect(await authHeaders(getToken)).toEqual({ authorization: 'Bearer tok_2' });
  await view.unmount();
});
test('a token failure rejects instead of sending a request unauthenticated', async () => {
  setClerkSession({ userId: 'user_1', token: new Error('Token refresh failed') });
  const { view } = await mount();
  await expect(authHeaders(getToken)).rejects.toThrow('Token refresh failed');
  await view.unmount();
});
test('the cache survives the first identity and is cleared when it changes', async () => {
  setClerkSession({ userId: 'user_1', token: 'tok_1' });
  const client = new QueryClient();
  client.setQueryData(['me'], { id: 'user_1' });
  const { view } = await mount(client);
  expect(client.getQueryData(['me'])).toEqual({ id: 'user_1' });
  await act(async () => setClerkSession({ userId: null, token: null }));
  expect(client.getQueryData(['me'])).toBeUndefined();
  await view.unmount();
});
