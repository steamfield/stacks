package consumer;

import static org.assertj.core.api.Assertions.assertThat;

import app.Slug;
import java.lang.module.ModuleDescriptor;
import org.junit.jupiter.api.Test;

class NamesTest {

    @Test
    void callsTheApiThroughTheInstalledJar() {
        assertThat(Names.describe("release-notes")).isEqualTo("ok: release-notes");
        assertThat(Names.describe("")).isEqualTo("empty");
        assertThat(Names.describe("a-very-long-release-name")).isEqualTo("too long: 24 > 16");
        assertThat(Names.describe("Notes")).isEqualTo("bad character LATIN CAPITAL LETTER N at 0");
        assertThat(Names.describe("notes-")).isEqualTo("bad hyphen at 5");
    }

    @Test
    void theLibraryIsANamedModuleExportingOnlyItsApi() {
        Module module = Slug.class.getModule();
        assertThat(module.isNamed()).isTrue();
        assertThat(module.getName()).isEqualTo("app");
        ModuleDescriptor descriptor = module.getDescriptor();
        assertThat(descriptor.exports())
                .extracting(ModuleDescriptor.Exports::source)
                .containsExactly("app");
        assertThat(descriptor.packages()).contains("app.internal");
    }
}
