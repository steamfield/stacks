import { useHealthGet } from "~/api/generated/client";
import { HealthGetResponse } from "~/api/generated/schemas";

export function useHealth() {
  return useHealthGet({
    query: { select: (body) => HealthGetResponse.parse(body) },
  });
}
