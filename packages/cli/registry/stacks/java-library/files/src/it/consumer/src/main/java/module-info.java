/**
 * A caller on the module path. It reads only what the library exports: an import of {@code
 * app.internal} here fails to compile.
 */
module consumer {
    requires app;
}
