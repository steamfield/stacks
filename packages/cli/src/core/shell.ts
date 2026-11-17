/**
 * Quotes shell arguments and tokenizes literal shell words for static checks. Expansions remain
 * text (trust point 1).
 */

/** Keeps a value literal when a printed command is pasted into a shell. */
export const shellArg = (text: string) =>
  /^[A-Za-z0-9._/+-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;

/** `shellTokens` without newlines. Other shell operators remain in the result. */
export function shellWords(command: string): string[] {
  return shellTokens(command)
    .filter((token) => !token.operator || token.word !== "\n")
    .map((token) => token.word);
}

/** A heredoc waiting for its body: the end delimiter, `<<-` tab stripping and whether it was quoted. */
type Heredoc = { delimiter: string; stripTabs: boolean; quoted: boolean };

/**
 * The index of the newline (or end of text) closing a heredoc body that starts at `start`. An
 * unquoted heredoc joins a line ending in an odd number of backslashes with the next one before
 * comparing it with the delimiter, as the shell does.
 */
function heredocEnd(command: string, start: number, heredoc: Heredoc): number {
  let offset = start;
  let line = "";
  while (offset < command.length) {
    const newline = command.indexOf("\n", offset);
    const end = newline < 0 ? command.length : newline;
    line += command.slice(offset, end);
    const backslashes = /\\+$/.exec(line)?.[0].length ?? 0;
    if (!heredoc.quoted && newline >= 0 && backslashes % 2 === 1) line = line.slice(0, -1);
    else {
      if ((heredoc.stripTabs ? line.replace(/^\t+/, "") : line) === heredoc.delimiter) return end;
      line = "";
    }
    offset = end + 1;
  }
  return command.length;
}

/**
 * Shell words and operators in order, with heredoc bodies skipped; newlines are operators.
 * Scanner helpers return the last character they consumed. Pending heredoc bodies start
 * after the next newline.
 */
export function shellTokens(command: string) {
  const words: { word: string; operator: boolean }[] = [];
  const heredocs: Heredoc[] = [];
  // Set right after `<<` or `<<-`: the next word is a heredoc delimiter.
  let delimiterTabs: boolean | undefined;
  let word = "";
  let quote: string | undefined;
  let wordQuoted = false;
  // Whether a word has started, which an empty quoted string (`''`) does too.
  let active = false;

  /** Ends the current word, recording it as a heredoc delimiter when one is expected. */
  const finish = () => {
    if (active) {
      words.push({ word, operator: false });
      if (delimiterTabs !== undefined) {
        heredocs.push({ delimiter: word, stripTabs: delimiterTabs, quoted: wordQuoted });
        delimiterTabs = undefined;
      }
    }
    word = "";
    wordQuoted = false;
    active = false;
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index] ?? "";
    index = quote ? quotedCharacter(index, char) : unquotedCharacter(index, char);
  }
  finish();
  return words;

  function unquotedCharacter(index: number, char: string): number {
    if (/["']/.test(char)) {
      quote = char;
      wordQuoted = true;
      active = true;
      return index;
    }
    if (char === "\\") return escapedCharacter(index);
    if (/\s/.test(char)) return whitespace(index, char);
    // A `#` starts a comment only at the start of a word; it runs to the end of the line.
    if (char === "#" && !active) {
      const newline = command.indexOf("\n", index);
      return newline < 0 ? command.length : newline - 1;
    }
    if (/[;&|()<>]/.test(char)) return operator(index, char);
    word += char;
    active = true;
    return index;
  }

  /** A backslash outside quotes: a line continuation, or the next character taken literally. */
  function escapedCharacter(index: number): number {
    if (command[index + 1] === "\n") return index + 1;
    wordQuoted = true;
    word += command[index + 1] ?? "";
    active = true;
    return index + 1;
  }

  /** Ends the word; a newline is also an operator, after which pending heredoc bodies are skipped. */
  function whitespace(index: number, char: string): number {
    finish();
    if (char !== "\n") return index;
    words.push({ word: char, operator: true });
    for (const heredoc of heredocs.splice(0)) index = heredocEnd(command, index + 1, heredoc);
    return index;
  }

  /** `<<<` (a here-string, no body), or `<<` and `<<-`, which make the next word a delimiter. */
  function heredocRedirect(index: number): number {
    finish();
    if (command[index + 2] === "<") {
      words.push({ word: "<<<", operator: true });
      return index + 2;
    }
    delimiterTabs = command[index + 2] === "-";
    words.push({ word: delimiterTabs ? "<<-" : "<<", operator: true });
    return index + (delimiterTabs ? 2 : 1);
  }

  function operator(index: number, char: string): number {
    if (char === "<" && command[index + 1] === "<") return heredocRedirect(index);
    finish();
    words.push({ word: char, operator: true });
    return index;
  }

  /** Inside quotes: the closing quote, the escapes double quotes allow, or a literal character. */
  function quotedCharacter(index: number, char: string): number {
    if (char === "\\" && quote === '"' && command[index + 1] === "\n") return index + 1;
    if (char === quote) quote = undefined;
    else if (char === "\\" && quote === '"' && /["\\$`]/.test(command[index + 1] ?? ""))
      word += command[++index] ?? "";
    else word += char;
    return index;
  }
}
