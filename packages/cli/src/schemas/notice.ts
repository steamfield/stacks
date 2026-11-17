/**
 * Defines the optional notice field shared by JSON results. Embedding the notice keeps stdout to
 * one object.
 */
import { Schema } from "effect";

/** The one additive result field on the invocation that first shows the privacy notice. */
export const NoticeFields = { notice: Schema.optionalKey(Schema.String) };
