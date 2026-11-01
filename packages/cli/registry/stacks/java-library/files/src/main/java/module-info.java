/**
 * Slugs: validated identifiers made of lowercase words joined by single hyphens.
 *
 * <p>The {@code app} package is the whole public API. {@code app.internal} holds the implementation
 * and is not exported, so callers on the module path can't compile against it.
 */
module app {
    // JSpecify's annotations are needed to compile against this module, not to run it.
    requires static org.jspecify;

    exports app;
}
