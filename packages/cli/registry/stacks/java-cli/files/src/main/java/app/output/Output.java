package app.output;

import app.errors.CliException;
import app.errors.ErrorCode;
import java.io.PrintStream;
import java.util.LinkedHashMap;
import java.util.Map;
import tools.jackson.databind.json.JsonMapper;

/**
 * The only code that writes results and errors. Results go to stdout, errors to stderr. Under
 * {@code --json} a result is one JSON document on one line and an error is {@code
 * {"error":{"code","message","suggestion"}}}.
 *
 * @param json write JSON instead of text
 * @param color color the human error label (off under --json, --no-color, NO_COLOR or no terminal)
 */
public record Output(boolean json, boolean color, PrintStream out, PrintStream err) {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    /** Write a command's result once: {@code value} as JSON, or {@code human} as text. */
    public void result(Object value, String human) throws CliException {
        out.println(json ? JSON.writeValueAsString(value) : human);
        out.flush();
        if (out.checkError()) {
            throw new CliException(ErrorCode.IO, "cannot write output");
        }
    }

    /** Report a failure once. A failure to write the report has nowhere left to go. */
    public void error(CliException failure) {
        ErrorCode code = failure.code();
        if (json) {
            Map<String, String> body = new LinkedHashMap<>();
            body.put("code", code.name());
            body.put("message", failure.getMessage());
            body.put("suggestion", code.suggestion());
            err.println(JSON.writeValueAsString(Map.of("error", body)));
        } else {
            String label = color ? "\u001b[31merror[" + code + "]\u001b[0m" : "error[" + code + "]";
            err.println(label + ": " + failure.getMessage() + "\n  suggestion: " + code.suggestion());
        }
        err.flush();
    }
}
