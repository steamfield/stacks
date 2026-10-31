import { Migrator } from "effect/sql";
import items from "./0001_items.ts";

// Every migration, by "<id>_<name>". Append new ones; never edit or reorder an applied one.
// db:check fails when a file in this directory is missing here, or the database disagrees.
export const migrations = {
  "0001_items": items,
};

export const loader = Migrator.fromRecord(migrations);
