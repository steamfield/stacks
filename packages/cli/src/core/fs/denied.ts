import { PermissionDenied, type PermissionDeniedDetails } from "../../errors";

export const denied = (reason: (typeof PermissionDeniedDetails.Type)["reason"], path: string) =>
  new PermissionDenied({ details: { reason, path } });
