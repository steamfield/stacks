import 'package:flutter_test/flutter_test.dart';

import '../../tool/ios_simulator.dart';

Map<String, Object?> _device(
  String udid, {
  String type = 'iPhone-17',
  String state = 'Shutdown',
  bool available = true,
}) => {
  'udid': udid,
  'name': 'Device $udid',
  'state': state,
  'isAvailable': available,
  'deviceTypeIdentifier': 'com.apple.CoreSimulator.SimDeviceType.$type',
};

const _old = 'com.apple.CoreSimulator.SimRuntime.iOS-9-2';
const _new = 'com.apple.CoreSimulator.SimRuntime.iOS-10-0';

void main() {
  test('prefers a booted iPhone on any runtime', () {
    final picked = pickSimulator({
      'devices': {
        _new: [_device('a')],
        _old: [_device('b', state: 'Booted')],
      },
    });
    expect(picked?.udid, 'b');
    expect(picked?.booted, isTrue);
  });

  test('otherwise takes the first iPhone on the newest runtime', () {
    final picked = pickSimulator({
      'devices': {
        _old: [_device('old')],
        _new: [_device('ipad', type: 'iPad-Air'), _device('new')],
      },
    });
    expect(picked?.udid, 'new');
    expect(picked?.booted, isFalse);
  });

  test('skips iPads, unavailable devices and other platforms', () {
    final picked = pickSimulator({
      'devices': {
        'com.apple.CoreSimulator.SimRuntime.watchOS-11-0': [_device('watch')],
        _new: [
          _device('ipad', type: 'iPad-Air'),
          _device('gone', available: false),
        ],
      },
    });
    expect(picked, isNull);
  });

  test('returns null for output it does not recognize', () {
    expect(pickSimulator(null), isNull);
    expect(pickSimulator({'devices': <Object?>[]}), isNull);
  });
}
