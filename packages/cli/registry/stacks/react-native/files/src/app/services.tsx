/**
 * The settings and logger every screen reads, provided once by the root component. Screens call
 * `useServices()` instead of importing a module-level config or logger.
 */
import { createContext, type ReactNode, useContext } from "react";
import type { AppConfig } from "../config";
import type { Logger } from "../logging";

export type Services = { config: AppConfig; logger: Logger };

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({ value, children }: { value: Services; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useContext(ServicesContext);
  if (services === null) throw new Error("useServices() needs a ServicesProvider above it.");
  return services;
}
