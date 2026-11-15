import type { Kind } from "@steamfield/stacks-format";
import type { Path } from "effect";
import type { Finding } from "../../schemas/validate";
import { markdownFile } from "../registry/entry";
import type { View } from "./types";

/** `inRoot` and `file` for the registry at `root`, whose entries live at `<kind dir>/<id>`. */
export function rootPaths(path: Path.Path, root: string): Pick<View, "inRoot" | "file"> {
  return {
    inRoot: (item) => path.dirname(path.dirname(item.dir)) === root,
    file: (item, inside) =>
      [path.relative(root, item.dir).split(path.sep).join("/"), inside].filter(Boolean).join("/"),
  };
}

/** A finding about one entry. */
export function finding(
  entry: { kind: Kind; id: string },
  fields: Omit<Finding, "kind" | "entry">,
): Finding {
  return { ...fields, kind: entry.kind, entry: entry.id };
}

/** The entry's markdown file, relative to the root. */
export const entryFile = (view: Pick<View, "file">, entry: { kind: Kind; dir: string }) =>
  view.file(entry, markdownFile(entry.kind));
