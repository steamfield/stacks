# Architecture

`app.main.create_app` builds a fresh FastAPI router tree. Importing it opens no
resources. The lifespan loads validated Settings, configures structlog and creates
MemoryNotes on app.state. Shutdown releases that store; a database implementation
would close its engine in the same finalizer.

`app/api/notes.py` decodes wire input, calls the async NoteStore seam and encodes
responses through `app/schemas.py`. The service uses dataclasses and has no FastAPI
imports. Store methods contain no awaits while mutating memory, so one event loop
owns each store. Multiple worker processes have separate data; use persistence
before deploying a resource that must survive a restart or work across workers.

`app/errors.py` owns the error table and domain exceptions; `app/error_handlers.py`
maps them to HTTP. `app/middleware.py` wraps every
HTTP request, catches unexpected failures before a response starts, adds request ids
and cache headers, then writes one request log. Defect records include class and
stack frames, never exception messages, bodies, raw paths, query values or locals.
The middleware resets context even when a request fails.

The generated OpenAPI document is the public contract. Operation ids derive
from router tags and function names. Tests exercise real routing and lifespan;
new features extend that boundary suite rather than replacing it with route mocks.
