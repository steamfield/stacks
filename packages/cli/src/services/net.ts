/**
 * Defines the TCP service for checking that a serve step can bind its port and that the port is
 * released afterward.
 */
import { Context, type Effect, Layer } from "effect";
import type { Socket } from "effect/socket";

/**
 * Acquiring the socket's `reader` opens the connection. `NetLayer` supplies the transport so
 * port checks stay independent of Node.
 */
export class Tcp extends Context.Service<
  Tcp,
  { connect: (host: string, port: number) => Effect.Effect<Socket.Socket> }
>()("stacks/Tcp") {
  static layer = (connect: (host: string, port: number) => Effect.Effect<Socket.Socket>) =>
    Layer.succeed(Tcp, { connect });
}
