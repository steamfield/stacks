---
paths:
  - "src/**/*.java"
  - "src/it/**"
  - "pom.xml"
  - ".mvn/**"
  - "api/**"
---

Read [Java guidance](../../docs/guidance/java.md) before changing Java code, the consumer project or the POM, and [the public API](../../docs/public-api.md) before changing anything in `app`: say whether a change is compatible before writing it, and never run `make api-baseline` to make `make api-check` pass. Publishing is the user's step (`docs/releasing.md`). To add a public type or method, use the `add-public-api` skill.
