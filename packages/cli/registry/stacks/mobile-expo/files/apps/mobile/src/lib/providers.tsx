import { QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { queryClient } from './query-client';

export function Providers({
  children,
  client = queryClient,
}: PropsWithChildren<{ client?: typeof queryClient }>) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
