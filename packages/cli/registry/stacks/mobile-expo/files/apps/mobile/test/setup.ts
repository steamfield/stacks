afterEach(() => {
  jest.restoreAllMocks();
});

// The native safe-area binding is unavailable outside a native binary.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
