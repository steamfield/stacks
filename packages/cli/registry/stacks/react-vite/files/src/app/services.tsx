import { createContext, type ReactNode, use } from "react";
import type { ApiClient } from "../api/client";
import type { Logger } from "../logging";

/** What components need from outside React: the API client and the logger. */
export type Services = { api: ApiClient; logger: Logger };

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider(props: { services: Services; children: ReactNode }) {
  return <ServicesContext value={props.services}>{props.children}</ServicesContext>;
}

export function useServices(): Services {
  const services = use(ServicesContext);
  if (!services) throw new Error("useServices needs a ServicesProvider above it");
  return services;
}
