import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Providers } from '../src/lib/providers';

export async function renderScreen(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  const view = await render(<Providers client={client}>{ui}</Providers>);
  return {
    ...view,
    client,
    rerender: (next: ReactElement) => view.rerender(<Providers client={client}>{next}</Providers>),
  };
}
export function mockJsonResponse(body: unknown, status = 200) {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}
