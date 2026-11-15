/**
 * The optional `notice` field most command results carry. The first run that may collect
 * telemetry shows a one-time privacy notice; in `--json` mode that text rides along in the result,
 * so those result schemas spread these fields in first. `telemetry/notice.ts` decides when the notice is due.
 */
import { Schema } from "effect";

/** The one additive result field on the invocation that first shows the privacy notice. */
export const NoticeFields = { notice: Schema.optionalKey(Schema.String) };
