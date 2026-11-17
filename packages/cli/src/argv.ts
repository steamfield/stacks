/** The arguments before the first `--`. */
export function beforeSeparator(args: readonly string[]): readonly string[] {
  const end = args.indexOf("--");
  return end === -1 ? args : args.slice(0, end);
}

export function hasFlag(args: readonly string[], ...flags: readonly string[]): boolean {
  return beforeSeparator(args).some((arg) => flags.includes(arg));
}
