package app;

import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;
import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noFields;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.core.importer.ImportOption;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;

/** The layering rules docs/ARCHITECTURE.md states, checked on the compiled main classes. */
class ArchitectureTest {

    private static final JavaClasses MAIN = new ClassFileImporter()
            .withImportOption(ImportOption.Predefined.DO_NOT_INCLUDE_TESTS)
            .importPackages("app");

    @Test
    void theDomainAndErrorsKnowNothingAboutTheWeb() {
        noClasses()
                .that()
                .resideInAnyPackage("app.notes..", "app.errors..", "app.config..")
                .should()
                .dependOnClassesThat()
                .resideInAnyPackage(
                        "app.web..",
                        "org.springframework.web..",
                        "org.springframework.http..",
                        "org.springframework.ui..",
                        "org.springframework.security..",
                        "org.thymeleaf..",
                        "jakarta.servlet..")
                .check(MAIN);
    }

    @Test
    void onlyTheEntryPointReadsTheEnvironment() {
        noClasses()
                .that()
                .doNotHaveFullyQualifiedName(Application.class.getName())
                .should()
                .callMethod(System.class, "getenv")
                .orShould()
                .callMethod(System.class, "getenv", String.class)
                .orShould()
                .callMethod(System.class, "getProperty", String.class)
                .check(MAIN);
    }

    @Test
    void settingsComeFromThePropertiesRecordNotValue() {
        noFields().should().beAnnotatedWith(Value.class).check(MAIN);
    }

    @Test
    void dependenciesArriveThroughConstructors() {
        noFields().should().beAnnotatedWith(Autowired.class).check(MAIN);
    }
}
