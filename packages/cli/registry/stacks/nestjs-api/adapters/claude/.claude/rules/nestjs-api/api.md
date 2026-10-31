---
paths:
  - "src/**"
---

Read [API guidance](../../../docs/guidance/nestjs-api/api.md) before changing the server. It is the shared guidance for every selected agent. Services throw `AppError` subclasses, never `HttpException`; a feature module exports only the services other modules need; injected classes and DTOs are value imports, never `import type`.
