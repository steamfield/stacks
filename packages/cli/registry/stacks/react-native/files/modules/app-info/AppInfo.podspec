# The AppInfo Turbo Module as a local pod. react-native.config.js points autolinking here, so
# `pod install` adds it to the app and runs codegen on src/; the app's Xcode project never
# needs a hand edit to compile new native code.
require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "AppInfo"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://reactnative.dev/docs/turbo-native-modules-introduction"
  s.license      = "UNLICENSED"
  s.authors      = "Project authors"
  s.platforms    = { :ios => min_ios_version_supported }
  s.source       = { :git => "" }

  s.source_files  = "ios/**/*.{h,m,mm,swift}"
  s.exclude_files = "ios/Tests/**"

  install_modules_dependencies(s)

  s.test_spec "Tests" do |t|
    t.source_files = "ios/Tests/**/*.swift"
  end
end
