import { apiUrl } from '../src/lib/api-url';
import { actionableMessage, apiError } from '../src/lib/queries/api-error';

test('resolves the Metro host and rejects missing release URLs', () => {
  expect(apiUrl('', true, '192.168.1.8:8081')).toBe('http://192.168.1.8:3000');
  expect(() => apiUrl('', false)).toThrow('EXPO_PUBLIC_API_URL');
  expect(() => apiUrl('https://api.example.com', false)).toThrow('EXPO_PUBLIC_API_URL');
  expect(apiUrl('https://api.test', false)).toBe('https://api.test');
});
test('preserves actionable server messages and handles proxy HTML', async () => {
  expect(
    actionableMessage(
      await apiError(new Response('{"message":"Invalid limit"}', { status: 400 }), 'Fallback'),
    ),
  ).toBe('Invalid limit');
  expect(
    actionableMessage(await apiError(new Response('<html/>', { status: 502 }), 'Fallback')),
  ).toBeNull();
});
