import { it } from "@effect/vitest";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { envPrefix, slug } from "../src/core/scaffold/slug";

test.each([
  ["My App", "my-app", "MY_APP"],
  ["@acme/web-app", "web-app", "WEB_APP"],
  ["Café Déjà Vu", "cafe-deja-vu", "CAFE_DEJA_VU"],
  ["myAPIServer2", "my-api-server2", "MY_API_SERVER2"],
  ["version2API", "version2api", "VERSION2API"],
  ["c1-go-docker", "c1-go-docker", "C1_GO_DOCKER"],
  ["web3-app", "web3-app", "WEB3_APP"],
  ["__init__", "init", "INIT"],
  ["a--b__c", "a-b-c", "A_B_C"],
  ["日本語", "project", "PROJECT"],
  ["@@@", "project", "PROJECT"],
  ["2048", "2048", "_2048"],
])("%j becomes slug %j and env prefix %j [3.1c#6]", (name, expected, prefix) => {
  expect(slug(name)).toBe(expected);
  expect(envPrefix(slug(name))).toBe(prefix);
});

it.prop(
  "slugs contain only ASCII words joined by single dashes [3.1c#6]",
  [Schema.String],
  ([name]) => {
    expect(slug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  },
);
