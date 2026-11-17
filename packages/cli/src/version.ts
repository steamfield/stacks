/** Provides the CLI identity from package metadata at build time. */
import metadata from "../package.json";
export const PACKAGE = metadata.name;
export const VERSION = metadata.version;
