package app.errors;

/**
 * Every failure the tool reports: a stable code scripts branch on, the exit status and a suggestion
 * that says how to fix it. Never rename or reuse a code.
 */
public enum ErrorCode {
    /** The command line is wrong: unknown command or option, missing subcommand or argument. */
    USAGE(2, "Run the command with --help for the supported commands and options."),
    /** A --config path that doesn't exist. */
    CONFIG_NOT_FOUND(3, "Check the --config path, or omit it to use the default files."),
    /** A config file that can't be read or isn't valid TOML with known keys. */
    CONFIG(3, "Fix the file's TOML, or remove or rename the key the message names."),
    /** A setting with a value outside its rules. */
    INVALID_SETTING(3, "Set the named setting to a valid value in the config file or environment."),
    /** Output that couldn't be written. */
    IO(1, "Check the output destination and retry."),
    /** A bug: an exception nothing expected. */
    INTERNAL(1, "This is a bug: report it with the stack trace logged above.");

    private final int exitCode;
    private final String suggestion;

    ErrorCode(int exitCode, String suggestion) {
        this.exitCode = exitCode;
        this.suggestion = suggestion;
    }

    /** 2 for a mistake in the invocation, 3 for bad configuration, 1 for anything else. */
    public int exitCode() {
        return exitCode;
    }

    public String suggestion() {
        return suggestion;
    }
}
