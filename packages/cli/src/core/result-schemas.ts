import { SearchResult } from "@steamfield/stacks-format";
import { Schema } from "effect";
import { ErrorEnvelope } from "../errors";
import { AddResult } from "../schemas/add";
import { CreateResult } from "../schemas/create";
import { DoctorReport } from "../schemas/doctor";
import { GuideAuthorResult, GuideResult } from "../schemas/guide";
import { ListResult } from "../schemas/list";
import { NewResult } from "../schemas/new";
import { ProjectRuns } from "../schemas/runs";
import { ShowReport } from "../schemas/show";
import { SkillResult } from "../schemas/skill";
import { TelemetryResult } from "../schemas/telemetry";
import { UpdateResult } from "../schemas/update";
import { BriefPreview, ValidateReport } from "../schemas/validate";
import { VerifyEvent, VerifyResult } from "../schemas/verify";

/**
 * Every JSON shape the CLI prints, by the name `schema <name>` takes: each command's `--json`
 * result, the error envelope and verify's live events. Sorted by name.
 */
export const RESULT_SCHEMAS = {
  add: { schema: AddResult, describes: "add --json" },
  create: { schema: CreateResult, describes: "create --json" },
  doctor: { schema: DoctorReport, describes: "doctor --json" },
  error: { schema: ErrorEnvelope, describes: "the last stderr line of any failed --json command" },
  guide: { schema: GuideResult, describes: "guide --json, and stacks --json alone" },
  "guide-author": { schema: GuideAuthorResult, describes: "guide author [topic] --json" },
  list: { schema: ListResult, describes: "list --json" },
  new: { schema: NewResult, describes: "new --json" },
  runs: { schema: ProjectRuns, describes: "runs --json" },
  search: { schema: SearchResult, describes: "search --json" },
  show: { schema: ShowReport, describes: "show --json" },
  skill: { schema: SkillResult, describes: "skill install --json" },
  telemetry: {
    schema: TelemetryResult,
    describes: "telemetry status|enable|disable|reset|flush --json",
  },
  update: { schema: UpdateResult, describes: "update --json" },
  validate: { schema: ValidateReport, describes: "validate --json" },
  "validate-brief": { schema: BriefPreview, describes: "validate --brief <stack> --json" },
  verify: { schema: VerifyResult, describes: "verify --json" },
  "verify-event": {
    schema: VerifyEvent,
    describes: "each live stderr line verify --json writes before the result",
  },
} as const;
export type ResultName = keyof typeof RESULT_SCHEMAS;
export const RESULT_NAMES = Object.keys(RESULT_SCHEMAS).filter(
  (name): name is ResultName => name in RESULT_SCHEMAS,
);

/**
 * `name`'s JSON Schema (draft 2020-12) as a standalone document. Objects are closed
 * (`additionalProperties: false`), as the CLI's own decoders are.
 */
export function jsonSchema(name: ResultName): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(RESULT_SCHEMAS[name].schema, {
    onExcessProperty: "error",
  });
  const definitions = document.definitions ?? {};
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    ...document.schema,
    ...(Object.keys(definitions).length ? { $defs: definitions } : {}),
  };
}
