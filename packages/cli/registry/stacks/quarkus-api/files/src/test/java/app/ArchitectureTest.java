package app;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noFields;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import jakarta.inject.Inject;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.junit.jupiter.api.Test;

/** The layering rules docs/ARCHITECTURE.md states, checked on the compiled main classes. */
class ArchitectureTest {

    private static final JavaClasses MAIN = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("app");

    @Test
    void theDomainAndErrorsKnowNothingAboutHttp() {
        noClasses()
                .that()
                .resideInAnyPackage("app.notes..", "app.errors..", "app.config..")
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage("app.web..", "jakarta.ws.rs..", "org.jboss.resteasy..", "io.vertx..")
                .check(MAIN);
    }

    @Test
    void onlyTheEntryPointReadsTheEnvironment() {
        noClasses()
                .that()
                .doNotHaveFullyQualifiedName(Main.class.getName())
                .should()
                .callMethod(System.class, "getenv")
                .orShould()
                .callMethod(System.class, "getenv", String.class)
                .orShould()
                .callMethod(System.class, "getProperty", String.class)
                .check(MAIN);
    }

    @Test
    void settingsComeFromTheConfigMappingNotConfigProperty() {
        noFields().should().beAnnotatedWith(ConfigProperty.class).check(MAIN);
    }

    @Test
    void dependenciesArriveThroughConstructors() {
        noFields().should().beAnnotatedWith(Inject.class).check(MAIN);
    }
}
