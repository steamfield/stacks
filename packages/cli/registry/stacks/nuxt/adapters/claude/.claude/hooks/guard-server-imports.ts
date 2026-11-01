// PreToolUse (Edit|Write): deny app code that imports from server/.
//
// Everything under app/ can run in the browser. Nuxt bundles whatever app/ imports into the
// client, so a server/ module pulled in there ships its code (and anything it reads) to every
// visitor, or fails the build. app/ reaches the server through its routes ($fetch, useFetch);
// code both sides need lives in shared/ (#shared/...).
import { isAbsolute, relative } from "node:path";
import { anyLine, deny, projectRoot, readPayload, text, writtenText } from "./_lib";

// import/export ... from "<spec>" or import("<spec>") where spec reaches server/: the root
// aliases (~~/server, @@/server), Nitro's #server alias, or a relative path through server/.
const SERVER_IMPORT =
  /(from|import)[ \t\n\v\f\r]*\(?[ \t\n\v\f\r]*["']((~~|@@)\/server(\/[^"']*)?|#server(\/[^"']*)?|(\.\.\/)+server(\/[^"']*)?)["']/;

/** The path relative to the project root, for absolute paths inside it and relative ones. */
function projectPath(filePath: string): string | undefined {
  if (!isAbsolute(filePath)) return filePath;
  const rel = relative(projectRoot(), filePath);
  return rel.startsWith("..") ? undefined : rel;
}

const payload = readPayload();
const filePath = text(payload?.tool_input?.file_path);
const rel = filePath ? projectPath(filePath) : undefined;
if (rel?.startsWith("app/") && /\.(vue|ts|tsx|js|mjs)$/.test(rel)) {
  const written = writtenText(payload?.tool_input);
  if (written && anyLine(SERVER_IMPORT, written)) {
    deny(
      `BLOCKED: ${rel} is app code, which Nuxt can bundle into the browser, and it imports from server/. Call the server through a route with useFetch or $fetch, and put code both sides need in shared/ (import it as #shared/...).`,
    );
  }
}
