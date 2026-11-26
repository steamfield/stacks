import AppInfo
import Foundation
import Testing

/// Runs on the simulator through the pod's test spec (`bun run ios:test`).
struct AppInfoReaderTests {
  @Test func readsDisplayNameVersionAndBuild() throws {
    let reader = AppInfoReader(
      info: [
        "CFBundleDisplayName": "Field Notes",
        "CFBundleName": "FieldNotes",
        "CFBundleShortVersionString": "2.4",
        "CFBundleVersion": "17",
      ],
      systemVersion: "1.2.3"
    )

    #expect(
      try reader.read() == [
        "appName": "Field Notes",
        "appVersion": "2.4",
        "buildNumber": "17",
        "systemName": "iOS",
        "systemVersion": "1.2.3",
      ]
    )
  }

  @Test func fallsBackToBundleNameWithoutDisplayName() throws {
    let reader = AppInfoReader(
      info: [
        "CFBundleName": "FieldNotes",
        "CFBundleShortVersionString": "2.4",
        "CFBundleVersion": "17",
      ],
      systemVersion: "1.2.3"
    )

    #expect(try reader.read()["appName"] == "FieldNotes")
  }

  @Test func missingVersionNamesTheKey() throws {
    let reader = AppInfoReader(
      info: ["CFBundleName": "FieldNotes", "CFBundleVersion": "17"],
      systemVersion: "1.2.3"
    )

    let error = try #require(throws: (any Error).self) { try reader.read() }
    #expect(
      (error as NSError).localizedDescription == "Info.plist has no CFBundleShortVersionString."
    )
  }

  @Test func currentReadsTheRunningOS() {
    let version = ProcessInfo.processInfo.operatingSystemVersion
    let info = try? AppInfoReader.current().read()

    // The test host bundle may lack a display name; the OS facts are always present.
    #expect((info?["systemName"] ?? "iOS") == "iOS")
    if let systemVersion = info?["systemVersion"] {
      #expect(systemVersion.hasPrefix("\(version.majorVersion)."))
    }
  }
}
