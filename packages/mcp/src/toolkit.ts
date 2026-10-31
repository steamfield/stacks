import { McpSchema, Tool, Toolkit } from "effect/ai";
import { CliFailure } from "./errors";
import { CliRunner } from "./run";
import {
  ListParams,
  ListSuccess,
  NewParams,
  NewSuccess,
  VerifyParams,
  VerifySuccess,
} from "./schemas/tools";

export const stacksList = Tool.make("stacks_list", {
  description:
    "List stacks, fragments and apps. Runs in the server's cwd, which determines project-origin entries. Use this first to pick a stack. Optionally select group: stacks, fragments or apps.",
  parameters: ListParams,
  success: ListSuccess,
  failure: CliFailure,
  dependencies: [CliRunner],
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Title, "List stacks and fragments")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, false);

export const stacksNew = Tool.make("stacks_new", {
  description:
    "Create a project from a stack, writing starter files and .stacks/BRIEF.md. dir must be absolute. Runs in the server's cwd, which determines project-origin entries. Runs nothing from the stack and never launches an agent. Omitting preset uses the user's setting. Returns the whole CLI result, including missing tools, warnings and handoff. Follow its brief, then verify.",
  parameters: NewParams,
  success: NewSuccess,
  failure: CliFailure,
  dependencies: [CliRunner],
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Title, "Create a project from a stack")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, false);

export const stacksVerify = Tool.make("stacks_verify", {
  description:
    "Run a project's manifest verify steps. dir must be an absolute existing directory. Executes project commands, which may change files or access the network. Returns green or partial (CLI exit 0), failed or changed (exit 5, with next); a red or changed verify is a successful call. For changed, stop: only a person can accept changes in a terminal. Tool errors include NotFound (outside a project, exit 2), InvalidConfig (3), PermissionDenied (6), Interrupted (130), CliUnavailable, CliTimedOut, CliOutputInvalid and InvalidArgument. Fix failed steps and verify until green.",
  parameters: VerifyParams,
  success: VerifySuccess,
  failure: CliFailure,
  dependencies: [CliRunner, McpSchema.McpRequestContext],
})
  .annotate(Tool.Strict, true)
  .annotate(Tool.Title, "Run a project's verify steps")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, true)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const toolkit = Toolkit.make(stacksList, stacksNew, stacksVerify);
