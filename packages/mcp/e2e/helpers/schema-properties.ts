import { Predicate } from "effect";

/** Inline references and omit documentation so schema comparisons check their wire contract. */
export function expandedSchema(
  schema: unknown,
  definitions: unknown = {},
  refs: ReadonlySet<string> = new Set(),
): unknown {
  if (Array.isArray(schema)) return schema.map((child) => expandedSchema(child, definitions, refs));
  if (!Predicate.isReadonlyObject(schema)) return schema;
  let inherited: Readonly<Record<string, unknown>> = {};
  if (typeof schema.$ref === "string") {
    const ref = schema.$ref;
    if (refs.has(ref)) throw new Error(`Recursive schema: ${ref}`);
    const name = ref
      .replace(/^#\/\$defs\//, "")
      .replace(/~1/g, "/")
      .replace(/~0/g, "~");
    if (!Predicate.isReadonlyObject(definitions) || !Object.hasOwn(definitions, name))
      throw new Error(`Unresolved ref ${ref}`);
    const resolved = expandedSchema(definitions[name], definitions, new Set([...refs, ref]));
    if (!Predicate.isReadonlyObject(resolved)) throw new Error(`Expected object reference ${ref}`);
    inherited = resolved;
  }
  const own = Object.fromEntries(
    Object.entries(schema)
      .filter(([key]) => !["$ref", "$defs", "$schema", "title", "description"].includes(key))
      .map(([key, value]) => [
        key,
        key === "properties"
          ? expandedProperties(value, definitions, refs)
          : expandedSchema(value, definitions, refs),
      ]),
  );
  return { ...inherited, ...own };
}

function expandedProperties(properties: unknown, definitions: unknown, refs: ReadonlySet<string>) {
  if (!Predicate.isReadonlyObject(properties)) throw new Error("Expected schema properties");
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      expandedSchema(value, definitions, refs),
    ]),
  );
}

/** Collect object property names by data path, unioning alternative JSON Schema branches. */
export function objectProperties(document: unknown, definitions: unknown = {}) {
  const result = new Map<string, Set<string>>();
  function visitReference(ref: string, path: string, refs: ReadonlySet<string>) {
    if (refs.has(ref)) throw new Error(`Recursive schema at ${path}: ${ref}`);
    const name = ref
      .replace(/^#\/\$defs\//, "")
      .replace(/~1/g, "/")
      .replace(/~0/g, "~");
    if (!Predicate.isReadonlyObject(definitions) || !Object.hasOwn(definitions, name))
      throw new Error(`Unresolved ref ${ref}`);
    visit(definitions[name], path, new Set([...refs, ref]));
  }
  function visitBranches(
    node: Readonly<Record<string, unknown>>,
    path: string,
    refs: ReadonlySet<string>,
  ) {
    for (const keyword of ["anyOf", "oneOf", "allOf"]) {
      const branches = node[keyword];
      if (Array.isArray(branches)) for (const branch of branches) visit(branch, path, refs);
    }
  }
  function visitProperties(properties: unknown, path: string, refs: ReadonlySet<string>) {
    if (Predicate.isReadonlyObject(properties)) {
      const names = result.get(path) ?? new Set<string>();
      for (const [key, child] of Object.entries(properties)) {
        names.add(key);
        visit(child, `${path}.${key}`, refs);
      }
      result.set(path, names);
    }
  }
  function visit(node: unknown, path: string, refs: ReadonlySet<string>) {
    if (path === "$.error.details") return;
    if (!Predicate.isReadonlyObject(node)) return;
    if (typeof node.$ref === "string") visitReference(node.$ref, path, refs);
    visitProperties(node.properties, path, refs);
    visitBranches(node, path, refs);
    if (node.items !== undefined) visit(node.items, `${path}[]`, refs);
  }
  visit(document, "$", new Set());
  return Object.fromEntries(
    [...result]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([path, keys]) => [path, [...keys].sort()]),
  );
}
