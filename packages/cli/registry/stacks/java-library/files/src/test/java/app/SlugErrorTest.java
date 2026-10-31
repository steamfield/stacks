package app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import org.junit.jupiter.api.Test;

class SlugErrorTest {

    @Test
    void messagesNameTheOffendingInput() {
        assertThat(new SlugError.Empty().message()).isEqualTo("a slug can't be empty");
        assertThat(new SlugError.TooLong(70, 64).message()).isEqualTo("a slug is at most 64 characters long, got 70");
        assertThat(new SlugError.InvalidChar('_', 3).message())
                .isEqualTo("invalid character '_' at index 3; use a-z, 0-9 and '-'");
        assertThat(new SlugError.InvalidChar(0x1F600, 0).message()).startsWith("invalid character '😀'");
        assertThat(new SlugError.MisplacedHyphen(0).message())
                .isEqualTo("misplaced '-' at index 0; a hyphen goes between two words");
    }

    @Test
    void exceptionsSurviveSerialization() throws IOException, ClassNotFoundException {
        SlugException original = new SlugException(new SlugError.InvalidChar('_', 3));
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ObjectOutputStream out = new ObjectOutputStream(bytes)) {
            out.writeObject(original);
        }
        try (ObjectInputStream in = new ObjectInputStream(new ByteArrayInputStream(bytes.toByteArray()))) {
            SlugException copy = (SlugException) in.readObject();
            assertThat(copy.error()).isEqualTo(original.error());
            assertThat(copy).hasMessage(original.getMessage());
        }
    }
}
