import { Context, Layer } from "effect";

export class Host extends Context.Service<
  Host,
  {
    name: string;
    version: string;
    platform: string;
    compiled: boolean;
  }
>()("app/Host") {
  static layer = (value: Host["Service"]) => Layer.succeed(Host, value);
}
