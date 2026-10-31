import '../global.css';
import { Stack } from 'expo-router';
import { Providers } from '../lib/providers';

export default function Layout() {
  return (
    <Providers>
      <Stack />
    </Providers>
  );
}
