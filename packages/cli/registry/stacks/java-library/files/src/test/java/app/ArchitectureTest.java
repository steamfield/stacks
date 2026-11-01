package app;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;

/** The library rules docs/guidance/java.md states, checked on the compiled main classes. */
class ArchitectureTest {

    private static final JavaClasses MAIN = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("app");

    @Test
    void libraryCodeHasNoSideEffectsOnTheProcess() {
        noClasses()
                .should()
                .callMethod(System.class, "getenv")
                .orShould()
                .callMethod(System.class, "getenv", String.class)
                .orShould()
                .callMethod(System.class, "getProperty", String.class)
                .orShould()
                .callMethod(System.class, "exit", int.class)
                .orShould()
                .accessField(System.class, "out")
                .orShould()
                .accessField(System.class, "err")
                .check(MAIN);
    }

    @Test
    void libraryCodeDoesNotLogThroughTheJdk() {
        noClasses()
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage("java.util.logging..")
                .check(MAIN);
    }
}
