package app.config;

import app.errors.CliException;
import app.errors.ErrorCode;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * The effective configuration every command receives. Its JSON keys are the config file's keys.
 *
 * @param greeting the hello-world setting that proves the layers end to end
 */
@JsonPropertyOrder({"greeting", "json", "verbose", "no-color"})
public record Config(
        String greeting,
        boolean json,
        boolean verbose,
        @JsonProperty("no-color") boolean noColor) {

    public static final Config DEFAULTS = new Config("Hello, world!", false, false, false);

    /** Fails on the first setting outside its rules. */
    public Config validate() throws CliException {
        if (greeting.isBlank()) {
            throw new CliException(ErrorCode.INVALID_SETTING, "invalid setting greeting: must contain text");
        }
        return this;
    }
}
