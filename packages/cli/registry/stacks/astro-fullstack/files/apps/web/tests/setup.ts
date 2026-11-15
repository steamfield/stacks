/**
 * Installs DOM assertions and cleans up rendered React trees after each test.
 * The web Vitest project loads this setup for its island tests.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);
