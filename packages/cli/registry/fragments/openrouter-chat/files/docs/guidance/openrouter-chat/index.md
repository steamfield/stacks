# openrouter-chat guidance

Read these references before changing the corresponding code. They apply to every selected agent; native rules and skills link here.

- [openrouter](openrouter.md): provider options, attribution, the models list, what to log, the no-key path
- [ai-sdk](ai-sdk.md): who owns what in a chat request, messages, tools and structured output
- [ui](ui.md): component boundaries, chat UI states and accessibility
- [styling](styling.md): the styling ladder and what the Grit plugin lints
- [design-slop](design-slop.md): structural and copy patterns that look generic, and how to review a page
- [rate-limiting](rate-limiting.md): the per-client limit and stream slots
- [testing](testing.md): fakes at the boundary, required coverage, fixtures and evals
- [verification](verification.md): what to run before calling work done
- [workflows](workflows.md): add a route, a service or a tool

`docs/openrouter.md` is the wire contract the stub follows; `docs/chat-turn.md` traces one chat request.
