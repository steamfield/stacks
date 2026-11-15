/**
 * Installs DOM assertions and cleans up rendered React trees after each test.
 * Vitest loads this setup for the frontend UI tests.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
