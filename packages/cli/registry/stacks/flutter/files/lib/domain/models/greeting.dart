/// The payload the home screen shows: the slice's stand-in for a real model.
final class Greeting {
  const Greeting({required this.message, required this.recipient});

  final String message;
  final String recipient;

  @override
  bool operator ==(Object other) =>
      other is Greeting &&
      other.message == message &&
      other.recipient == recipient;

  @override
  int get hashCode => Object.hash(message, recipient);

  @override
  String toString() => 'Greeting($message)';
}
