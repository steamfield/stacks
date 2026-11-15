// biome-ignore-all lint/suspicious/noTemplateCurlyInString: `${{ ... }}` text is what these tests are about.
import { it } from "@effect/vitest";
import { Schema } from "effect";
import { expect, test } from "vitest";
import { envPrefix, slug } from "../src/core/slug";
import { renderTemplate, type TemplateValues } from "../src/core/template";

const values: TemplateValues = {
  project_name: "My App",
  project_slug: "my-app",
  env_prefix: "MY_APP",
  package_scope: "acme",
  author: "Ada",
  year: "2026",
};
const render = (text: string) => renderTemplate(text, values);

test.each([
  ["{{project_name}}", "My App"],
  ["{{ project_name }}", "My App"],
  ["{{\tproject_slug\t}}", "my-app"],
  ["${{{project_slug}}}", "${my-app}"],
  ["${{ secrets.NPM_TOKEN }}", "${{ secrets.NPM_TOKEN }}"],
  ["{{ project_name", "{{ project_name"],
  ["{{\nproject_name }}", "{{\nproject_name }}"],
  ["{{project_name}}{{year}}", "My App2026"],
  ["{{}}", "{{}}"],
  ["{{ 1abc }}", "{{ 1abc }}"],
])("the token rule renders %j as %j [1.2a#13]", (input, output) => {
  expect(render(input)).toEqual({ text: output });
});

test("an identifier that isn't a known variable is reported with its line [1.2a#13]", () => {
  expect(render("ok {{year}}\n\n  ${{ github }}\n")).toEqual({ unknown: "github", line: 3 });
  expect(render("{{ Project_Name }}")).toEqual({ unknown: "Project_Name", line: 1 });
});

test("every fixed variable renders, and nothing else is a variable", () => {
  expect(
    render(
      "{{project_name}}|{{project_slug}}|{{env_prefix}}|{{package_scope}}|{{author}}|{{year}}",
    ),
  ).toEqual({ text: "My App|my-app|MY_APP|acme|Ada|2026" });
  expect(render("{{ dir }}")).toEqual({ unknown: "dir", line: 1 });
});

test("a value is inserted as is, never re-scanned for tokens", () => {
  expect(renderTemplate("{{author}}", { ...values, author: "{{year}}" })).toEqual({
    text: "{{year}}",
  });
});

test.each([
  ["My App", "my-app", "MY_APP"],
  ["__init__", "init", "INIT"],
  ["a--b__c", "a-b-c", "A_B_C"],
  ["日本語", "project", "PROJECT"],
  ["@@@", "project", "PROJECT"],
  ["2048", "2048", "_2048"],
])("slug(%j) is %j and its env prefix %j [1.2a#11]", (name, slugged, prefix) => {
  expect(slug(name)).toBe(slugged);
  expect(envPrefix(slug(name))).toBe(prefix);
});

it.prop(
  "slug output is always lowercase ASCII words joined by single dashes [1.2a#11]",
  [Schema.String],
  ([name]) => {
    expect(slug(name)).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  },
);
