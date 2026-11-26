// Prints the UDID of the iPhone simulator `make test-ios` runs on, booting it
// first when needed. Set SIMULATOR_UDID to a UDID to choose one yourself.
//
// Picks a booted iPhone if there is one, else the first iPhone on the newest
// iOS runtime, so no device name or OS version is written down anywhere.
import 'dart:convert';
import 'dart:io';

/// A simulator from `xcrun simctl list devices available -j`.
typedef Simulator = ({String udid, String name, bool booted});

Future<void> main() async {
  final chosen = Platform.environment['SIMULATOR_UDID']?.trim() ?? '';
  final Simulator simulator;
  if (chosen.isNotEmpty) {
    simulator = (udid: chosen, name: chosen, booted: false);
  } else {
    final listing = await _xcrun(['list', 'devices', 'available', '-j']);
    final picked = pickSimulator(jsonDecode(listing));
    if (picked == null) {
      stderr.writeln(
        'No available iPhone simulator. Add an iOS runtime in Xcode '
        '(Settings > Components), or create one with xcrun simctl create.',
      );
      exit(1);
    }
    simulator = picked;
  }
  if (!simulator.booted) {
    stderr.writeln('Booting ${simulator.name}');
    // bootstatus -b boots the device if needed and waits until it is ready.
    await _xcrun(['bootstatus', simulator.udid, '-b']);
  }
  stdout.writeln(simulator.udid);
}

/// Chooses a simulator from the decoded `simctl list -j` output, or null.
Simulator? pickSimulator(Object? listing) {
  if (listing is! Map<String, Object?>) return null;
  final devices = listing['devices'];
  if (devices is! Map<String, Object?>) return null;
  final runtimes = devices.keys.where(_isIos).toList()
    ..sort((a, b) => _compareVersions(_version(b), _version(a)));
  final phones = [
    for (final runtime in runtimes) ..._iPhones(devices[runtime]),
  ];
  for (final phone in phones) {
    if (phone.booted) return phone;
  }
  return phones.isEmpty ? null : phones.first;
}

bool _isIos(String runtime) => runtime.contains('SimRuntime.iOS-');

List<int> _version(String runtime) => runtime
    .split('SimRuntime.iOS-')
    .last
    .split('-')
    .map((part) => int.tryParse(part) ?? 0)
    .toList();

int _compareVersions(List<int> a, List<int> b) {
  for (var i = 0; i < a.length && i < b.length; i++) {
    if (a[i] != b[i]) return a[i].compareTo(b[i]);
  }
  return a.length.compareTo(b.length);
}

Iterable<Simulator> _iPhones(Object? devices) sync* {
  if (devices is! List<Object?>) return;
  for (final device in devices) {
    if (device is! Map<String, Object?>) continue;
    final type = device['deviceTypeIdentifier'];
    final udid = device['udid'];
    final name = device['name'];
    if (device['isAvailable'] == false ||
        type is! String ||
        !type.contains('iPhone') ||
        udid is! String ||
        name is! String) {
      continue;
    }
    yield (udid: udid, name: name, booted: device['state'] == 'Booted');
  }
}

Future<String> _xcrun(List<String> simctlArgs) async {
  final result = await Process.run('xcrun', ['simctl', ...simctlArgs]);
  if (result.exitCode != 0) {
    stderr.write(result.stderr);
    exit(result.exitCode);
  }
  return result.stdout as String;
}
