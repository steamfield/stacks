import { Schema } from "effect";

export class CliFailure extends Schema.TaggedError<CliFailure>()("CliFailure", {
  tag: Schema.String,
  cliMessage: Schema.String,
  next: Schema.String,
  retryable: Schema.Boolean,
  exitCode: Schema.optionalKey(Schema.Int),
  details: Schema.optionalKey(Schema.Unknown),
}) {
  get message(): string {
    const metadata = {
      tag: this.tag,
      retryable: this.retryable,
      ...(this.exitCode === undefined ? {} : { exitCode: this.exitCode }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
    return `${this.cliMessage}\nNext: ${this.next}\n\n${JSON.stringify(metadata)}`;
  }
}

export class ConfigInvalid extends Schema.TaggedError<ConfigInvalid>()("ConfigInvalid", {
  message: Schema.String,
}) {}
