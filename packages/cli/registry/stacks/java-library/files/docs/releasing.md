# Releasing

Publishing to Maven Central is permanent: a released version can't be changed or deleted. A person publishes, with their own Central Portal account and signing key; agents prepare the release and stop.

## Before the first release

- The group id is a namespace the publisher has verified on the Central Portal (central.sonatype.com): a reversed domain they own, or `io.github.<github login>`. Set `<groupId>` in `pom.xml`.
- The module and package names match it. Rename `app` (the module in `module-info.java`, the package directories under `src/main/java`, `src/test/java` and `src/it/consumer`, every `package` and `import` line, `exports`, the `app.internal` exclude in the japicmp configuration, `jar-check` in the Makefile and `requires app;` in the consumer and README) in one change, then run `make ci`. Two libraries that both export a package named `app` can't be on one module path.
- `pom.xml` has what Central requires: `name`, `description`, `url`, `licenses`, `developers` and `scm`. Add `url` and `scm` (`connection`, `developerConnection`, `url`) once the repository exists.
- The README says what the library does and shows the Maven dependency.

## Each release

1. Decide the version from [the compatibility rules](public-api.md#compatibility). `make api-check` passing means nothing exported broke since the baseline; a compatible addition is the next minor, a fix the next patch.
2. Set `<version>` in `pom.xml` (drop `-SNAPSHOT`) and note the change for users in the release notes or a `CHANGELOG.md`.
3. Run `make ci`. `make build` checks the jar's module descriptor and that the sources and Javadoc jars exist; Central rejects a release without them.
4. The person publishes. The first time, they add a `release` profile to `pom.xml` with `org.sonatype.central:central-publishing-maven-plugin` (`<extensions>true</extensions>`, `<publishingServerId>central</publishingServerId>`) and `org.apache.maven.plugins:maven-gpg-plugin` (the `sign` goal in the `verify` phase), each with a `${...}` version property filled from Maven Central, and a `central` server in `~/.m2/settings.xml` holding their Portal token. Then `./mvnw -P release deploy`, and they review and publish the deployment on the Portal unless `autoPublish` is on. They tag the commit `v<version>`.
5. Record the released API as the baseline: `make api-baseline`, then commit `api/baseline.jar`. Set the next `-SNAPSHOT` version.

## A breaking release

From the first major version (1) on, a breaking change needs a new major version. `make api-check` fails on it until the person who agreed to it runs `make api-baseline` and commits the result. While the major version is 0, the user may agree to break in a minor release; the baseline rule is the same.
