import { fireEvent } from '@testing-library/react-native';
import Home from '../src/app/index';
import { mockJsonResponse, renderScreen } from './render';

test('shows API health through the real query hook and hc client', async () => {
  mockJsonResponse({ status: 'ok', uptime: 12 });
  const screen = await renderScreen(<Home />);
  expect(await screen.findByText('API status: ok')).toBeTruthy();
  await screen.unmount();
});
test('shows a recoverable error when the API is unavailable', async () => {
  mockJsonResponse({ message: 'Unavailable' }, 503);
  const screen = await renderScreen(<Home />);
  expect(await screen.findByText('Cannot reach the API. Try again.')).toBeTruthy();
  await screen.unmount();
});
test('recovers through the retry control when the API comes back', async () => {
  mockJsonResponse({ status: 'ok', uptime: 12 }).mockResolvedValueOnce(
    new Response('{"message":"Unavailable"}', { status: 503 }),
  );
  const screen = await renderScreen(<Home />);
  await screen.findByText('Cannot reach the API. Try again.');
  await fireEvent.press(screen.getByRole('button', { name: 'Retry API connection' }));
  expect(await screen.findByText('API status: ok')).toBeTruthy();
  await screen.unmount();
});
