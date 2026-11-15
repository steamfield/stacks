/**
 * A shorter import path for a few common schemas (`config.ts` imports `Settings` from here). Most
 * code imports a schema from its own file, such as `schemas/new.ts`; both reach the same values.
 */
export { Settings } from "./config";
export { DoctorReport } from "./doctor";
export { GuideResult } from "./guide";
export { ListResult, ListRow } from "./list";
export { NewResult } from "./new";
export { Origin } from "./origin";
