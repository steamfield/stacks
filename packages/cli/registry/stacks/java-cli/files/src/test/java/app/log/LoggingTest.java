package app.log;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class LoggingTest {

    private static final Logger LOG = LoggerFactory.getLogger(LoggingTest.class);

    private final ByteArrayOutputStream stderr = new ByteArrayOutputStream();

    private String logged() {
        return stderr.toString(StandardCharsets.UTF_8);
    }

    @Test
    void debugIsHiddenUnlessVerbose() {
        Logging.start(false, false, stderr);
        LOG.debug("hidden");
        LOG.warn("shown");
        assertThat(logged()).doesNotContain("hidden").contains("WARN LoggingTest: shown");
    }

    @Test
    void verboseTextKeepsKeyValuePairs() {
        Logging.start(false, true, stderr);
        LOG.atDebug().addKeyValue("greeting", "hi").log("detail");
        assertThat(logged()).contains("DEBUG LoggingTest: detail").contains("greeting=\"hi\"");
    }

    @Test
    void jsonLogsAreOneObjectPerLine() {
        Logging.start(true, true, stderr);
        LOG.atDebug().addKeyValue("greeting", "hi").log("detail");
        String line =
                logged().lines().filter(l -> l.contains("detail")).findFirst().orElseThrow();
        JsonNode record = JsonMapper.builder().build().readTree(line);
        assertThat(record.get("level").asString()).isEqualTo("DEBUG");
        assertThat(record.get("message").asString()).isEqualTo("detail");
        assertThat(record.get("kvpList").toString()).contains("greeting");
    }
}
