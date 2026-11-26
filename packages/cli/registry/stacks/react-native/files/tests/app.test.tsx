/**
 * Renders the real App (navigation, services, error boundary) and drives it like a person.
 * Only the native spec is replaced: Jest has no iOS runtime behind TurboModuleRegistry.
 */
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { App } from "../src/app/app";

// jest.mock factories may only reference variables whose names start with "mock".
const mockGetAppInfo = jest.fn<Promise<unknown>, []>();

jest.mock("../modules/app-info/src/NativeAppInfo", () => ({
  __esModule: true,
  default: { getAppInfo: () => mockGetAppInfo() },
}));

const info = {
  appName: "Field Notes",
  appVersion: "2.4",
  buildNumber: "17",
  systemName: "iOS",
  systemVersion: "1.2.3",
};

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function openAppInfo() {
  await render(<App config={{ logLevel: "error" }} />);
  await fireEvent.press(screen.getByRole("button", { name: "Show app info" }));
}

beforeEach(() => {
  mockGetAppInfo.mockReset();
});

test("navigates from home to app info and shows loading, then the native answer", async () => {
  const answer = deferred<unknown>();
  mockGetAppInfo.mockReturnValue(answer.promise);

  await openAppInfo();
  expect(screen.getByLabelText("Loading app info")).toBeOnTheScreen();

  await act(async () => answer.resolve(info));
  expect(screen.getByText("Field Notes")).toBeOnTheScreen();
  expect(screen.getByText("2.4 (17)")).toBeOnTheScreen();
  expect(screen.getByText("iOS 1.2.3")).toBeOnTheScreen();
});

test("shows the mapped error for a native rejection and recovers on retry", async () => {
  mockGetAppInfo
    .mockRejectedValueOnce(
      Object.assign(new Error("no version"), { code: "E_APP_INFO_MISSING_KEY" }),
    )
    .mockResolvedValueOnce(info);

  await openAppInfo();
  expect(await screen.findByText("Couldn't read app info")).toBeOnTheScreen();
  expect(screen.getByText("The device couldn't read this information.")).toBeOnTheScreen();

  await fireEvent.press(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Field Notes")).toBeOnTheScreen();
  expect(mockGetAppInfo).toHaveBeenCalledTimes(2);
});

test("an answer in the wrong shape shows the decode message without a retry", async () => {
  mockGetAppInfo.mockResolvedValue({ appName: "Field Notes" });

  await openAppInfo();
  expect(
    await screen.findByText("The device sent data this version of the app doesn't understand."),
  ).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("invalid settings render the error boundary instead of the app", async () => {
  const error = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    await render(<App config={{ nativeTimeoutMs: -1 }} />);
    expect(screen.getByText("Something went wrong")).toBeOnTheScreen();
    expect(screen.getByText(/settings are invalid: nativeTimeoutMs/)).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Show app info" })).toBeNull();
    const logged = error.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes('"event":"render.failed"'))).toBe(true);
  } finally {
    error.mockRestore();
  }
});
