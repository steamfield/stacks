import { Schema, SchemaGetter } from "effect";
import { HttpApiSchema } from "effect/http-api";

export const apiErrorTable = {
  BadInput: { status: 400, message: "Invalid request.", retryable: false },
  NotFound: { status: 404, message: "Resource not found.", retryable: false },
  UnsupportedMediaType: { status: 415, message: "Expected a JSON body.", retryable: false },
  PayloadTooLarge: { status: 413, message: "Request body is too large.", retryable: false },
  Unavailable: { status: 503, message: "Service unavailable.", retryable: true },
  Defect: { status: 500, message: "Internal server error.", retryable: false },
} as const;

export type ApiErrorTag = keyof typeof apiErrorTable;

export class BadInput extends Schema.TaggedError<BadInput>()(
  "BadInput",
  {},
  {
    httpApiStatus: apiErrorTable.BadInput.status,
  },
) {
  override readonly message = apiErrorTable.BadInput.message;
}
export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  {},
  {
    httpApiStatus: apiErrorTable.NotFound.status,
  },
) {
  override readonly message = apiErrorTable.NotFound.message;
}
export class UnsupportedMediaType extends Schema.TaggedError<UnsupportedMediaType>()(
  "UnsupportedMediaType",
  {},
  {
    httpApiStatus: apiErrorTable.UnsupportedMediaType.status,
  },
) {
  override readonly message = apiErrorTable.UnsupportedMediaType.message;
}
export class PayloadTooLarge extends Schema.TaggedError<PayloadTooLarge>()(
  "PayloadTooLarge",
  {},
  {
    httpApiStatus: apiErrorTable.PayloadTooLarge.status,
  },
) {
  override readonly message = apiErrorTable.PayloadTooLarge.message;
}
export class Unavailable extends Schema.TaggedError<Unavailable>()(
  "Unavailable",
  {},
  {
    httpApiStatus: apiErrorTable.Unavailable.status,
  },
) {
  override readonly message = apiErrorTable.Unavailable.message;
}
export class Defect extends Schema.TaggedError<Defect>()(
  "Defect",
  {},
  {
    httpApiStatus: apiErrorTable.Defect.status,
  },
) {
  override readonly message = apiErrorTable.Defect.message;
}

export const errorClasses = [
  BadInput,
  NotFound,
  UnsupportedMediaType,
  PayloadTooLarge,
  Unavailable,
  Defect,
] as const;

function wireError<Tag extends ApiErrorTag, Type>(
  tag: Tag,
  schema: Schema.Codec<Type, { readonly _tag: Tag }>,
) {
  const row = apiErrorTable[tag];
  const envelope = Schema.Struct({
    error: Schema.Struct({
      tag: Schema.Literal(tag),
      message: Schema.Literal(row.message),
      retryable: Schema.Literal(row.retryable),
    }),
  });
  return schema.pipe(
    Schema.encodeTo(envelope, {
      decode: SchemaGetter.transform(() => ({ _tag: tag })),
      encode: SchemaGetter.transform(() => ({
        error: { tag, message: row.message, retryable: row.retryable },
      })),
    }),
    HttpApiSchema.status(row.status),
  );
}

export const BadInputResponse = wireError("BadInput", BadInput);
export const UnsupportedMediaTypeResponse = wireError("UnsupportedMediaType", UnsupportedMediaType);
export const apiErrors = [
  BadInputResponse,
  wireError("NotFound", NotFound),
  UnsupportedMediaTypeResponse,
  wireError("PayloadTooLarge", PayloadTooLarge),
  wireError("Unavailable", Unavailable),
  wireError("Defect", Defect),
] as const;
export const ErrorEnvelope = Schema.Struct({
  error: Schema.Union(
    Object.entries(apiErrorTable).map(([tag, row]) =>
      Schema.Struct({
        tag: Schema.Literal(tag),
        message: Schema.Literal(row.message),
        retryable: Schema.Literal(row.retryable),
      }),
    ),
  ),
});

export function errorEnvelope(tag: ApiErrorTag): typeof ErrorEnvelope.Type {
  const row = apiErrorTable[tag];
  return { error: { tag, message: row.message, retryable: row.retryable } };
}

export function tagForStatus(status: number): ApiErrorTag {
  switch (status) {
    case apiErrorTable.BadInput.status:
      return "BadInput";
    case apiErrorTable.NotFound.status:
      return "NotFound";
    case apiErrorTable.UnsupportedMediaType.status:
      return "UnsupportedMediaType";
    case apiErrorTable.PayloadTooLarge.status:
      return "PayloadTooLarge";
    case apiErrorTable.Unavailable.status:
      return "Unavailable";
    default:
      return "Defect";
  }
}
