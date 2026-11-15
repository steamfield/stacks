// A small shell lexer for the Bash guards. It splits a command line into the simple commands bash
// would run, with quotes removed, so a guard can look at a command word and its arguments instead
// of grepping raw text. Text that isn't run as a command doesn't reach the guards: quoted
// arguments (a commit message), heredoc bodies fed to a program that isn't a shell (a Python
// script, a file written with cat), and # comments.
//
// Commands that run other commands are followed: $( ), backticks, <( ), substitutions inside an
// unquoted heredoc, bash/sh -c, eval, su -c, heredocs and pipes into a shell, ssh (and scripts
// named like *ssh*), xargs, find -exec, docker/kubectl exec and run, and wrappers such as sudo,
// env, timeout, nice. Input fed to a command (heredocs, a pipe from echo or a heredoc) travels with
// it as `stdin`, including through ssh and docker exec, so a guard can read the SQL sent to psql.
//
// It errs toward matching: a quote left open means the line was misread, so it is lexed again with
// quotes as ordinary characters, and a line nested too deep or expanding into too many commands
// yields an `opaque` command, which the guards deny.
import { basename, join } from "node:path";

export type Command = {
  /** From the command word on, quotes removed. Empty for a bare redirect (> file). */
  argv: string[];
  /** Per argv word, whether any part of it was quoted (a quoted * is not a glob). */
  quoted: boolean[];
  /** Per argv word, whether it contains unresolved shell expansion syntax. */
  expands: boolean[];
  /** Assignments before the command word (GIT_DIR=x git ...). */
  env: string[];
  /** Redirect targets (> /dev/sda). */
  redirects: string[];
  /** Text fed to the command's standard input: heredocs, or what's piped in from echo or a heredoc. */
  stdin: string[];
  /** Fed its arguments by xargs, directly or through a shell xargs runs. */
  viaXargs: boolean;
  /** Runs somewhere this machine's state can't be checked (ssh, a container). */
  remote: boolean;
  /** Directory relative to where the line starts (undefined: there), from cd, pushd, popd; null: unknown. */
  dir: string | null | undefined;
  /** Too deeply nested or too long to follow; guards treat it as destructive. */
  opaque?: boolean;
  /** Programs supplying a pipe or process substitution to this command. */
  inputPrograms?: string[];
  /** An asynchronous pipeline in a function body can recursively exhaust processes. */
  background?: boolean;
  functionName?: string;
};

type Word = { text: string; quoted: boolean; expands: boolean };
type Simple = {
  words: Word[];
  redirects: string[];
  heredocs: string[];
  scope: number;
  pipedFrom?: Simple;
  conditionalFrom?: Simple;
  inputs?: Simple[];
  background?: boolean;
  functionName?: string;
};

const BLANK = new Set([" ", "\t", "\r", "\v", "\f"]);
/** A trailing & detaches the whole conditional list and every pipeline in it. */
function markBackground(simple: Simple): void {
  simple.background = true;
  if (simple.pipedFrom) markBackground(simple.pipedFrom);
  if (simple.conditionalFrom) markBackground(simple.conditionalFrom);
}

const WORD_END = new Set([...BLANK, "\n", ";", "&", "|", "<", ">", "(", ")"]);

class Unbalanced extends Error {}

const ANSI_ESCAPES: Readonly<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  e: "\x1b",
  E: "\x1b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
  v: "\v",
  "\\": "\\",
  "'": "'",
  '"': '"',
  "?": "?",
};

/** One Bash ANSI-C escape, without its backslash; undefined means it cannot be decoded. */
function ansiEscape(sequence: string): string | undefined {
  const literal = ANSI_ESCAPES[sequence];
  if (literal !== undefined) return literal;
  if (/^[0-7]+$/.test(sequence)) return String.fromCharCode(Number.parseInt(sequence, 8) & 255);
  if (/^[xuU]/.test(sequence)) {
    if (sequence.length === 1) return undefined;
    const code = Number.parseInt(sequence.slice(1), 16);
    return code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : undefined;
  }
  if (sequence.startsWith("c")) {
    if (sequence.length === 1) return undefined;
    return String.fromCharCode(
      sequence === "c?" ? 127 : sequence.charAt(1).toUpperCase().charCodeAt(0) & 31,
    );
  }
  return `\\${sequence}`;
}

function ansiWord(source: string): Word {
  let expands = false;
  const text = source.replace(
    /\\(x[\da-fA-F]{0,2}|u[\da-fA-F]{0,4}|U[\da-fA-F]{0,8}|[0-7]{1,3}|c[\s\S]?|[\s\S])/g,
    (raw: string, sequence: string) => {
      const decoded = ansiEscape(sequence);
      if (decoded !== undefined) return decoded;
      expands = true;
      return raw;
    },
  );
  // Bash ends this quoted segment at the first NUL, then resumes after its closing quote.
  return { text: text.split("\0")[0] ?? "", quoted: true, expands };
}

/** Shared by the lex calls for one line: output, whether quotes count, and subshell scopes. */
type Lexing = { raw: boolean; out: Simple[]; parents: Map<number, number> };

/**
 * Where one lex call reads: `src` from `start`, in subshell `scope`. With `stopAtParen` it is a
 * substitution body and ends at its closing ).
 */
type Source = { src: string; start: number; stopAtParen: boolean; scope: number };

const newScope = (lx: Lexing, parent: number) => {
  const id = lx.parents.size + 1;
  lx.parents.set(id, parent);
  return id;
};

/** Index just past the )) closing an arithmetic expression opened at `from` (after its (( ). */
function arithmeticEnd(src: string, from: number): number {
  let depth = 2;
  for (let i = from; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i + 1;
  }
  throw new Unbalanced();
}

/** Index just past the ` closing a backtick substitution whose body starts at `from`. */
function backtickEnd(src: string, from: number): number {
  let j = from;
  while (j < src.length && src.charAt(j) !== "`") j += src.charAt(j) === "\\" ? 2 : 1;
  if (j >= src.length) throw new Unbalanced();
  return j + 1;
}

/** Lex the command substitutions in an unquoted heredoc body, which bash runs. */
function heredocSubstitutions(lx: Lexing, body: string, scope: number) {
  for (let i = 0; i < body.length; i++) {
    const c = body.charAt(i);
    if (c === "\\") i++;
    else if (c === "$" && body.startsWith("$((", i)) i = arithmeticEnd(body, i + 3) - 1;
    else if (c === "$" && body.charAt(i + 1) === "(")
      i = lex(lx, { src: body, start: i + 2, stopAtParen: true, scope: newScope(lx, scope) }) - 1;
    else if (c === "`") {
      const end = body.indexOf("`", i + 1);
      if (end < 0) throw new Unbalanced();
      lex(lx, {
        src: body.slice(i + 1, end),
        start: 0,
        stopAtParen: false,
        scope: newScope(lx, scope),
      });
      i = end;
    }
  }
}

/**
 * Lex a source into lx.out (substitution bodies first, as they run first). A substitution body
 * returns the index just past its closing ); anything else returns the end.
 */
function lex(lx: Lexing, source: Source): number {
  return new Lexer(lx, source).run();
}

type Heredoc = { delim: string; strip: boolean; expands: boolean; cmd: Simple };

/** One lex call: the command and word being built, and the heredocs waiting for their bodies. */
class Lexer {
  private readonly lx: Lexing;
  private readonly src: string;
  private readonly n: number;
  private readonly stopAtParen: boolean;
  private readonly scopes: number[];
  private readonly scopeStarts: number[];
  private readonly pending: Heredoc[] = [];
  private readonly functions: { brace: number; name: string }[] = [];
  private braces = 0;
  private cmd: Simple;
  private word = "";
  private inWord = false;
  private quoted = false;
  private expands = false;
  private redirectNext = false;
  private i: number;
  /** Set on reaching the ) that closes a substitution body: the index just past it. */
  private closedAt: number | undefined;

  constructor(lx: Lexing, source: Source) {
    this.lx = lx;
    this.src = source.src;
    this.n = source.src.length;
    this.stopAtParen = source.stopAtParen;
    this.scopes = [source.scope];
    this.scopeStarts = [lx.out.length];
    this.i = source.start;
    this.cmd = this.fresh();
  }

  run(): number {
    while (this.i < this.n) {
      const c = this.src.charAt(this.i);
      if (!this.token(c)) {
        this.add(c, false, /[*?[{$~]/.test(c));
        this.i++;
      }
      if (this.closedAt !== undefined) return this.closedAt;
    }
    if (!this.lx.raw && this.stopAtParen) throw new Unbalanced();
    this.endCmd();
    return this.n;
  }

  /** Consume the token starting with `c` if it is more than a plain word character. */
  private token(c: string): boolean {
    return (
      this.newline(c) ||
      this.escape(c) ||
      this.ansiQuoted() ||
      this.singleQuoted(c) ||
      this.doubleQuoted(c) ||
      this.arithmetic() ||
      this.substitution(c) ||
      this.backtick(c) ||
      this.comment(c) ||
      this.blank(c) ||
      this.functionDefinition(c) ||
      this.brace(c) ||
      this.subshell(c) ||
      this.pipe(c) ||
      this.separator(c) ||
      this.redirect(c)
    );
  }

  private get current(): number {
    return this.scopes[this.scopes.length - 1] as number;
  }

  private fresh(pipedFrom?: Simple, conditionalFrom?: Simple): Simple {
    const functionName = this.functions.at(-1)?.name;
    return {
      words: [],
      redirects: [],
      heredocs: [],
      scope: this.current,
      ...(functionName ? { functionName } : {}),
      ...(pipedFrom ? { pipedFrom } : {}),
      ...(conditionalFrom ? { conditionalFrom } : {}),
    };
  }

  private add(text: string, isQuoted = false, expansion = false) {
    this.word += text;
    this.inWord = true;
    if (isQuoted) this.quoted = true;
    if (expansion) this.expands = true;
  }

  /** Add an expansion's source up to `end` to the word, and continue from there. */
  private takeUntil(end: number) {
    this.add(this.src.slice(this.i, end), false, true);
    this.i = end;
  }

  private endWord() {
    if (!this.inWord) return;
    if (this.redirectNext) this.cmd.redirects.push(this.word);
    else this.cmd.words.push({ text: this.word, quoted: this.quoted, expands: this.expands });
    this.redirectNext = false;
    this.word = "";
    this.inWord = false;
    this.quoted = false;
    this.expands = false;
  }

  private endCmd(pipe = false, background = false, conditional = false) {
    this.endWord();
    const done = this.cmd.words.length > 0 || this.cmd.redirects.length > 0 ? this.cmd : undefined;
    if (done) {
      done.background = background;
      if (background) {
        markBackground(done);
      }
      this.lx.out.push(done);
    }
    this.cmd = this.fresh(pipe ? done : undefined, conditional ? done : undefined);
  }

  /** Lex a nested substitution body at `from`, in a new scope; returns the index past its ). */
  private nested(from: number): number {
    return lex(this.lx, {
      src: this.src,
      start: from,
      stopAtParen: true,
      scope: newScope(this.lx, this.current),
    });
  }

  /** Lex a backtick body starting at `from`; returns the index past its closing `. */
  private backtickBody(from: number): number {
    const end = backtickEnd(this.src, from);
    lex(this.lx, {
      src: this.src.slice(from, end - 1),
      start: 0,
      stopAtParen: false,
      scope: newScope(this.lx, this.current),
    });
    return end;
  }

  private newline(c: string): boolean {
    if (c !== "\n") return false;
    this.endCmd();
    this.i = this.readHeredocs(this.i + 1);
    return true;
  }

  /** The bodies of the heredocs opened on the line just ended, starting at `from`. */
  private readHeredocs(from: number): number {
    let i = from;
    for (const doc of this.pending) {
      const body: string[] = [];
      while (i < this.n) {
        const nl = this.src.indexOf("\n", i);
        const end = nl < 0 ? this.n : nl;
        const line = this.src.slice(i, end);
        i = end + 1;
        if ((doc.strip ? line.replace(/^\t+/, "") : line) === doc.delim) break;
        body.push(line);
      }
      const text = body.join("\n");
      doc.cmd.heredocs.push(text);
      if (doc.expands) heredocSubstitutions(this.lx, text, doc.cmd.scope);
    }
    this.pending.length = 0;
    return Math.min(i, this.n);
  }

  private escape(c: string): boolean {
    if (this.lx.raw || c !== "\\") return false;
    if (this.src.charAt(this.i + 1) !== "\n") this.add(this.src.charAt(this.i + 1), true);
    this.i += 2;
    return true;
  }

  private singleQuoted(c: string): boolean {
    if (this.lx.raw || c !== "'") return false;
    const j = this.src.indexOf("'", this.i + 1);
    if (j < 0) throw new Unbalanced();
    this.add(this.src.slice(this.i + 1, j), true);
    this.i = j + 1;
    return true;
  }

  private ansiQuoted(): boolean {
    if (this.lx.raw || !this.src.startsWith("$'", this.i)) return false;
    let end = this.i + 2;
    while (end < this.n && this.src.charAt(end) !== "'") {
      end += this.src.charAt(end) === "\\" ? 2 : 1;
    }
    if (end >= this.n) throw new Unbalanced();
    const word = ansiWord(this.src.slice(this.i + 2, end));
    this.add(word.text, true, word.expands);
    this.i = end + 1;
    return true;
  }

  private doubleQuoted(c: string): boolean {
    if (this.lx.raw || c !== '"') return false;
    this.add("", true);
    this.i++;
    while (this.src.charAt(this.i) !== '"') {
      if (this.i >= this.n) throw new Unbalanced();
      this.doubleQuotedPart();
    }
    this.i++;
    return true;
  }

  /** One escape, expansion or character inside double quotes. */
  private doubleQuotedPart() {
    const { src, i } = this;
    const d = src.charAt(i);
    if (d === "\\" && '$`"\\\n'.includes(src.charAt(i + 1))) {
      if (src.charAt(i + 1) !== "\n") this.add(src.charAt(i + 1));
      this.i += 2;
    } else if (src.startsWith("$((", i)) this.takeUntil(arithmeticEnd(src, i + 3));
    else if (d === "$" && src.charAt(i + 1) === "(") this.takeUntil(this.nested(i + 2));
    else if (d === "`") this.takeUntil(this.backtickBody(i + 1));
    else {
      this.add(d, false, d === "$");
      this.i++;
    }
  }

  /** Arithmetic: nothing runs, and 1<<2 isn't a heredoc. */
  private arithmetic(): boolean {
    const dollar = this.src.startsWith("$((", this.i);
    if (!dollar && (this.inWord || !this.src.startsWith("((", this.i))) return false;
    this.takeUntil(arithmeticEnd(this.src, this.i + (dollar ? 3 : 2)));
    return true;
  }

  /** $( ) command substitution, <( ) and >( ) process substitution. */
  private substitution(c: string): boolean {
    if (!"$<>".includes(c) || this.src.charAt(this.i + 1) !== "(") return false;
    const start = this.lx.out.length;
    const end = this.nested(this.i + 2);
    if (c === "<") {
      this.cmd.inputs = [...(this.cmd.inputs ?? []), ...this.lx.out.slice(start)];
    }
    this.takeUntil(end);
    return true;
  }

  private backtick(c: string): boolean {
    if (this.lx.raw || c !== "`") return false;
    this.takeUntil(this.backtickBody(this.i + 1));
    return true;
  }

  private comment(c: string): boolean {
    if (c !== "#" || this.inWord) return false;
    while (this.i < this.n && this.src.charAt(this.i) !== "\n") this.i++;
    return true;
  }

  private blank(c: string): boolean {
    if (!BLANK.has(c)) return false;
    this.endWord();
    this.i++;
    return true;
  }

  private subshell(c: string): boolean {
    if (c !== "(" && c !== ")") return false;
    this.endCmd();
    this.i++;
    if (c === "(") {
      this.scopes.push(newScope(this.lx, this.current));
      this.scopeStarts.push(this.lx.out.length);
    } else if (this.scopes.length > 1) this.closeSubshell();
    else {
      if (this.stopAtParen) this.closedAt = this.i;
      return true;
    }
    this.cmd = this.fresh();
    return true;
  }

  private closeSubshell() {
    const start = this.scopeStarts.pop() ?? this.lx.out.length;
    if (/^[ \t]*&(?!&)/.test(this.src.slice(this.i))) {
      for (const command of this.lx.out.slice(start)) command.background = true;
    }
    this.scopes.pop();
  }

  private functionDefinition(c: string): boolean {
    if (c !== "(") return false;
    const name = this.inWord ? this.word : this.cmd.words.at(-1)?.text;
    const words = this.cmd.words.length + Number(this.inWord);
    const expected = this.cmd.words[0]?.text === "function" ? 2 : 1;
    if (!name || words !== expected) return false;
    const header = /^\(\s*\)\s*\{/.exec(this.src.slice(this.i));
    if (!header) return false;
    this.endCmd();
    this.functions.push({ brace: ++this.braces, name });
    this.cmd = this.fresh();
    this.i += header[0].length;
    return true;
  }

  private brace(c: string): boolean {
    if (this.inWord || !"{}".includes(c)) return false;
    if (!this.cmd.words.every((word) => KEYWORDS.has(word.text))) return false;
    const next = this.src.charAt(this.i + 1);
    if (next && !WORD_END.has(next)) return false;
    this.endCmd();
    if (c === "{") this.braces++;
    else {
      if (this.functions.at(-1)?.brace === this.braces) this.functions.pop();
      this.braces--;
    }
    this.cmd = this.fresh();
    this.i++;
    return true;
  }

  /** | and |& pipe into the next command; || doesn't. */
  private pipe(c: string): boolean {
    if (c !== "|") return false;
    const or = this.src.charAt(this.i + 1) === "|";
    this.endCmd(!or, false, or);
    this.i += or || this.src.charAt(this.i + 1) === "&" ? 2 : 1;
    return true;
  }

  private separator(c: string): boolean {
    if (c !== ";" && !(c === "&" && this.src.charAt(this.i + 1) !== ">")) return false;
    const and = c === "&" && this.src.charAt(this.i + 1) === "&";
    this.endCmd(false, c === "&" && !and, and);
    this.i += and ? 2 : 1;
    return true;
  }

  private redirect(c: string): boolean {
    if (c !== "&" && c !== "<" && c !== ">") return false;
    // A word of digits right before the operator is a file descriptor (2>&1), not an argument.
    if (this.inWord && !this.quoted && /^[0-9]+$/.test(this.word)) {
      this.word = "";
      this.inWord = false;
    } else this.endWord();
    if (this.src.startsWith("<<<", this.i)) {
      this.i += 3; // A here-string: the next word is an ordinary argument.
    } else if (this.src.startsWith("<<", this.i)) {
      this.heredoc();
    } else {
      // > >> >& <& >| <> &> &>>
      this.i++;
      while (this.i < this.n && ">&|".includes(this.src.charAt(this.i))) this.i++;
      this.redirectNext = true;
    }
    return true;
  }

  /** A heredoc's operator and delimiter; its body is read after the line ends. */
  private heredoc() {
    this.i += 2;
    const strip = this.src.charAt(this.i) === "-";
    if (strip) this.i++;
    while (BLANK.has(this.src.charAt(this.i))) this.i++;
    let delim = "";
    let delimQuoted = false;
    while (this.i < this.n && !WORD_END.has(this.src.charAt(this.i))) {
      const d = this.src.charAt(this.i);
      if (d === "'" || d === '"' || d === "\\") delimQuoted = true;
      else if (!(d === "$" && "'\"".includes(this.src.charAt(this.i + 1)))) delim += d;
      this.i++;
    }
    if (delim) this.pending.push({ delim, strip, expands: !delimQuoted, cmd: this.cmd });
  }
}

function simples(src: string): { list: Simple[]; parents: Map<number, number> } {
  const lx: Lexing = { raw: false, out: [], parents: new Map() };
  try {
    lex(lx, { src, start: 0, stopAtParen: false, scope: 0 });
    return { list: lx.out, parents: lx.parents };
  } catch (error) {
    if (!(error instanceof Unbalanced)) throw error;
  }
  const rawLx: Lexing = { raw: true, out: [], parents: new Map() };
  try {
    lex(rawLx, { src, start: 0, stopAtParen: false, scope: 0 });
  } catch (error) {
    if (!(error instanceof Unbalanced)) throw error;
    // Even without quotes the parentheses don't close: read each line as one command.
    return {
      list: src.split("\n").map((line) => ({
        words: line
          .split(/[ \t]+/)
          .map((text) => ({ text, quoted: false, expands: /[*?[{$~]/.test(text) })),
        redirects: [],
        heredocs: [],
        scope: 0,
      })),
      parents: new Map(),
    };
  }
  return { list: rawLx.out, parents: rawLx.parents };
}

const KEYWORDS = new Set([
  "if",
  "then",
  "else",
  "elif",
  "do",
  "while",
  "until",
  "!",
  "{",
  "}",
  "time",
]);
const WRAPPERS = new Set([
  "sudo",
  "doas",
  "env",
  "exec",
  "command",
  "builtin",
  "nohup",
  "time",
  "nice",
  "ionice",
  "timeout",
  "stdbuf",
  "busybox",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

type StartState = "top" | "args";

/**
 * Every position the command word could be at, after assignments, keywords, and wrappers with
 * their options (sudo -u root, timeout 5, nice -n 10). A wrapper's option may or may not take the
 * next word as its value, so both readings are kept; each (position, state) is visited once.
 */
function commandStarts(words: Word[]): number[] {
  const starts: number[] = [];
  const seen = new Set<string>();
  const queue: [number, StartState][] = [];
  const push = (k: number, state: StartState) => {
    const key = `${k}:${state}`;
    if (k > words.length || seen.has(key)) return;
    seen.add(key);
    queue.push([k, state]);
  };
  push(0, "top");
  for (let next = queue.pop(); next; next = queue.pop()) {
    const [k, state] = next;
    const text = words[k]?.text;
    if (state === "args") wrapperArgs(words, k, push);
    else if (text !== undefined) {
      starts.push(k);
      if (KEYWORDS.has(text) || ASSIGNMENT.test(text)) push(k + 1, "top");
      if (WRAPPERS.has(basename(text))) push(k + 1, "args");
    }
  }
  return starts.length > 0 ? starts : [0];
}

/** The readings after a wrapper's word at `k`: the command itself, or past an option or value. */
function wrapperArgs(words: Word[], k: number, push: (k: number, state: StartState) => void) {
  push(k, "top");
  const text = words[k]?.text;
  if (text === undefined) return;
  if (text.startsWith("-")) {
    push(k + 1, "args");
    const value = words[k + 1]?.text;
    if (value !== undefined && !value.startsWith("-")) push(k + 2, "args");
  } else if (/^[0-9]/.test(text) || ASSIGNMENT.test(text)) {
    push(k + 1, "args");
  }
}

type Context = {
  remote: boolean;
  dir: string | null | undefined;
  viaXargs: boolean;
  background?: boolean;
};
/** One line's expansion: how deep it is, how many commands are left before the rest is opaque, and the output. */
type Walk = { depth: number; budget: { commands: number }; out: Command[] };

const MAX_DEPTH = 8;

function joinDir(dir: string | null | undefined, target: string | undefined): string | null {
  if (dir === null || target === undefined || /[$~`]/.test(target) || target === "-") return null;
  if (target.startsWith("/")) return target;
  return join(dir ?? ".", target);
}

const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh"]);
const SSH_VALUE_OPTIONS = "BbcDEeFIiJLlmOoPpQRSWw";
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);

function opaque(ctx: Context): Command {
  return {
    argv: [],
    quoted: [],
    expands: [],
    env: [],
    redirects: [],
    stdin: [],
    viaXargs: ctx.viaXargs,
    remote: ctx.remote,
    dir: null,
    opaque: true,
  };
}

type ScopeDir = { dir: string | null | undefined; stack: (string | null)[] };

/** The cd, pushd and popd directory per subshell scope; a scope starts from its parent's. */
function scopeDirs(start: string | null | undefined, parents: Map<number, number>) {
  const dirs = new Map<number, ScopeDir>();
  const scopeOf = (id: number): ScopeDir => {
    let entry = dirs.get(id);
    if (!entry) {
      const parent = parents.get(id);
      entry = { dir: parent === undefined ? start : scopeOf(parent).dir, stack: [] };
      dirs.set(id, entry);
    }
    return entry;
  };
  return scopeOf;
}

/** Track a cd, pushd or popd in `scope` for the commands after it. */
function changeDirectory(scope: ScopeDir, words: Word[]) {
  const [first, target] = words.map((w) => w.text);
  if (first === "cd" || first === "pushd") {
    if (first === "pushd") scope.stack.push(scope.dir ?? null);
    scope.dir = joinDir(scope.dir, target);
  } else if (first === "popd") {
    scope.dir = scope.stack.length > 0 ? (scope.stack.pop() as string | null) : null;
  }
}

/**
 * Lex `src` and push its commands (and the ones they run) onto the walk's output. `stdin` is input
 * the caller feeds this command line (an ssh command's heredoc), given to each of its commands.
 */
function expand(src: string, ctx: Context, walk: Walk, stdin: string[] = []): void {
  if (walk.depth > MAX_DEPTH) {
    walk.out.push(opaque(ctx));
    return;
  }
  const { list, parents } = simples(src);
  const scopeOf = scopeDirs(ctx.dir, parents);
  for (const simple of list) {
    const scope = scopeOf(simple.scope);
    if (!expandSimple(simple, { ...ctx, dir: scope.dir }, walk, stdin)) return;
    changeDirectory(scope, simple.words);
  }
}

function expandSimple(simple: Simple, ctx: Context, walk: Walk, stdin: string[]): boolean {
  const input = [...simple.heredocs, ...stdin, ...pipedInput(simple.pipedFrom)];
  for (const start of commandStarts(simple.words)) {
    if (--walk.budget.commands < 0) {
      walk.out.push(opaque(ctx));
      return false;
    }
    const words = simple.words.slice(start);
    if (ASSIGNMENT.test(words[0]?.text ?? "")) continue;
    if (words[0]?.expands) {
      walk.out.push(opaque(ctx));
      continue;
    }
    const cmd: Command = {
      argv: words.map((w) => w.text),
      quoted: words.map((w) => w.quoted),
      expands: words.map((w) => w.expands),
      env: simple.words
        .slice(0, start)
        .map((w) => w.text)
        .filter((t) => ASSIGNMENT.test(t)),
      redirects: simple.redirects,
      stdin: input,
      viaXargs: ctx.viaXargs,
      remote: ctx.remote,
      dir: ctx.dir,
      inputPrograms: inputPrograms(simple),
      background: ctx.background || simple.background || false,
      ...(simple.functionName ? { functionName: simple.functionName } : {}),
    };
    walk.out.push(cmd);
    follow(cmd, walk);
  }
  return true;
}

function inputPrograms(simple: Simple): string[] {
  const inputs = [...(simple.inputs ?? [])];
  if (simple.pipedFrom) inputs.push(simple.pipedFrom);
  return inputs.flatMap((input) =>
    commandStarts(input.words).map((start) => basename(input.words[start]?.text ?? "")),
  );
}

/** What a command piped into another feeds it: a heredoc, or the text echo or printf prints. */
function pipedInput(from: Simple | undefined): string[] {
  if (!from) return [];
  const [first, ...rest] = from.words.map((w) => w.text);
  const printed = first === "echo" || first === "printf" ? [rest.join(" ")] : [];
  return [...from.heredocs, ...printed];
}

/** What a follower needs to report the commands one command runs. */
type Following = {
  cmd: Command;
  argv: string[];
  /** This command's context, and a remote one (ssh, su: nothing here can be checked). */
  same: Context;
  remote: Context;
  /** Expand a command line one level deeper. */
  run: (src: string, ctx: Context, stdin?: string[]) => void;
  /** A command made of argv[from..], fed this command's stdin (docker exec -i, xargs). */
  sub: (from: number, extra: Partial<Command>) => void;
};

/** A shell's -c script, or its stdin when it reads commands from there. */
function followShell({ cmd, argv, same, run }: Following) {
  let i = 1;
  let script = false;
  while (i < argv.length && /^[-+]/.test(argv[i] as string)) {
    const opt = argv[i] as string;
    if (/^-[A-Za-z]*c/.test(opt)) script = true;
    i += ["-o", "+o", "-O", "+O"].includes(opt) ? 2 : 1;
  }
  if (script && argv[i] !== undefined) run(argv[i] as string, same);
  else if (argv[i] === undefined || argv[i] === "-s") for (const text of cmd.stdin) run(text, same);
}

/** ssh [options] host [command], or a wrapper script such as scripts/prod-ssh.sh "<command>". */
function followSsh({ cmd, argv, remote, run }: Following, name: string) {
  let i = 1;
  if (name === "ssh") {
    while (i < argv.length && (argv[i] as string).startsWith("-")) {
      const opt = argv[i] as string;
      i += opt.length === 2 && SSH_VALUE_OPTIONS.includes(opt.charAt(1)) ? 2 : 1;
    }
    i++; // the host
  }
  const remoteCommand = argv.slice(i).join(" ");
  if (remoteCommand.trim()) run(remoteCommand, remote, cmd.stdin);
  else for (const text of cmd.stdin) run(text, remote);
}

/** find's -exec family: the words up to ; or + are a command. */
function followFind({ argv, same, run }: Following) {
  argv.forEach((a, k) => {
    if (!FIND_EXEC.has(a)) return;
    const end = argv.findIndex((b, j) => j > k && (b === ";" || b === "+"));
    const inner = argv.slice(k + 1, end < 0 ? undefined : end);
    if (inner.length > 0) run(inner.map(quoteWord).join(" "), same);
  });
}

/** docker [compose] exec|run [options] <container|service|image> <command>...: every position after an operand. */
function followContainer({ argv, sub }: Following) {
  const at = argv.findIndex((a) => a === "exec" || a === "run");
  for (let k = at + 1; k < argv.length; k++) {
    if (!(argv[k] as string).startsWith("-")) sub(k + 1, { remote: true, dir: null });
  }
}

/** Which follower handles a command, by its program name and arguments. */
const FOLLOWERS: ReadonlyArray<{
  matches: (name: string, argv: string[]) => boolean;
  follow: (f: Following, name: string) => void;
}> = [
  { matches: (name) => SHELLS.has(name), follow: followShell },
  { matches: (name) => name === "eval", follow: (f) => f.run(f.argv.slice(1).join(" "), f.same) },
  {
    matches: (name) => name === "su",
    follow: (f) => {
      const c = f.argv.findIndex((a) => a === "-c" || a === "--command");
      if (c > 0 && f.argv[c + 1] !== undefined) f.run(f.argv[c + 1] as string, f.remote);
    },
  },
  {
    matches: (name) => name === "ssh" || (name.includes("ssh") && !name.startsWith("ssh-")),
    follow: followSsh,
  },
  {
    // xargs [options] command...: the command is a non-option word, or follows an option's value.
    matches: (name) => name === "xargs",
    follow: (f) => {
      for (let k = 1; k < f.argv.length; k++) {
        if (!(f.argv[k] as string).startsWith("-")) f.sub(k, { viaXargs: true });
      }
    },
  },
  { matches: (name) => name === "find", follow: followFind },
  {
    matches: (name, argv) =>
      ["docker", "podman", "docker-compose"].includes(name) &&
      argv.some((a) => a === "exec" || a === "run"),
    follow: followContainer,
  },
  {
    matches: (name, argv) => name === "kubectl" && argv.includes("exec") && argv.includes("--"),
    follow: (f) => f.sub(f.argv.indexOf("--") + 1, { remote: true, dir: null }),
  },
];

/** Commands that `cmd` runs: a shell's -c script or stdin, an ssh remote command, xargs'... */
function follow(cmd: Command, walk: Walk): void {
  const { argv } = cmd;
  const name = basename(argv[0] ?? "");
  const follower = FOLLOWERS.find((candidate) => candidate.matches(name, argv));
  if (!follower) return;
  const same: Context = {
    remote: cmd.remote,
    dir: cmd.dir,
    viaXargs: cmd.viaXargs,
    ...(cmd.background ? { background: true } : {}),
  };
  const deeper: Walk = { ...walk, depth: walk.depth + 1 };
  const sub = (from: number, extra: Partial<Command>) => {
    if (from >= argv.length) return;
    if (--walk.budget.commands < 0 || deeper.depth > MAX_DEPTH) {
      walk.out.push(opaque(same));
      return;
    }
    const next: Command = {
      ...cmd,
      argv: argv.slice(from),
      quoted: cmd.quoted.slice(from),
      expands: cmd.expands.slice(from),
      env: [],
      ...extra,
    };
    walk.out.push(next);
    follow(next, deeper);
  };
  follower.follow(
    {
      cmd,
      argv,
      same,
      remote: { remote: true, dir: null, viaXargs: cmd.viaXargs },
      run: (src, ctx, stdin = []) => expand(src, ctx, deeper, stdin),
      sub,
    },
    name,
  );
}

/** A word quoted for re-lexing (find -exec's words are already unquoted). */
const quoteWord = (word: string) => `'${word.replaceAll("'", "'\\''")}'`;

/** The simple commands in a Bash tool command line, including the ones it runs indirectly. */
export function commands(line: string): Command[] {
  const out: Command[] = [];
  expand(
    line,
    { remote: false, dir: undefined, viaXargs: false },
    { depth: 0, budget: { commands: 2000 }, out },
  );
  return out;
}
