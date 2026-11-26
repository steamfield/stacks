/**
 * Jest setup for every test file: native modules Jest can't run get their libraries' own mocks.
 */
import mockSafeAreaContext from "react-native-safe-area-context/jest/mock";

jest.mock("react-native-safe-area-context", () => mockSafeAreaContext);
