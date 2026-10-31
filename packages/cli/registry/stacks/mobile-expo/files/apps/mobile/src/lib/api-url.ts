import Constants from 'expo-constants';

export function apiUrl(
  value = process.env.EXPO_PUBLIC_API_URL,
  dev = __DEV__,
  host = Constants.expoConfig?.hostUri,
) {
  if (!dev && (!value || value.includes('api.example.com'))) {
    throw new Error('Set EXPO_PUBLIC_API_URL to the deployed API before building a release.');
  }
  const url = value || `http://${host ? new URL(`http://${host}`).hostname : 'localhost'}:3000`;
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('API URL must use HTTP or HTTPS.');
  return url;
}
