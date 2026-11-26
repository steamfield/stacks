import AppInfo
import XCTest

/// Runs on the simulator through the pod's test spec (`bun run ios:test`).
final class AppInfoReaderTests: XCTestCase {
  func testReadsDisplayNameVersionAndBuild() throws {
    let reader = AppInfoReader(
      info: [
        "CFBundleDisplayName": "Field Notes",
        "CFBundleName": "FieldNotes",
        "CFBundleShortVersionString": "2.4",
        "CFBundleVersion": "17",
      ],
      systemVersion: "1.2.3"
    )

    XCTAssertEqual(
      try reader.read(),
      [
        "appName": "Field Notes",
        "appVersion": "2.4",
        "buildNumber": "17",
        "systemName": "iOS",
        "systemVersion": "1.2.3",
      ]
    )
  }

  func testFallsBackToBundleNameWithoutDisplayName() throws {
    let reader = AppInfoReader(
      info: [
        "CFBundleName": "FieldNotes",
        "CFBundleShortVersionString": "2.4",
        "CFBundleVersion": "17",
      ],
      systemVersion: "1.2.3"
    )

    XCTAssertEqual(try reader.read()["appName"], "FieldNotes")
  }

  func testMissingVersionNamesTheKey() {
    let reader = AppInfoReader(
      info: ["CFBundleName": "FieldNotes", "CFBundleVersion": "17"],
      systemVersion: "1.2.3"
    )

    XCTAssertThrowsError(try reader.read()) { error in
      XCTAssertEqual(
        (error as NSError).localizedDescription,
        "Info.plist has no CFBundleShortVersionString."
      )
    }
  }

  func testCurrentReadsTheRunningOS() {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    let info = try? AppInfoReader.current().read()

    // The xctest host bundle may lack a display name; the OS facts are always present.
    XCTAssertEqual(info?["systemName"] ?? "iOS", "iOS")
    if let systemVersion = info?["systemVersion"] {
      XCTAssertTrue(systemVersion.hasPrefix("\(version.majorVersion)."))
    }
  }
}
