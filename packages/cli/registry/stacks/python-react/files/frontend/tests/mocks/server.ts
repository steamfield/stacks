import { setupServer } from "msw/node";
import { getFastAPIMock } from "~/api/generated/client.msw";

export const server = setupServer(...getFastAPIMock());
