import type { CollectionEntry } from "astro:content";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { PostHeader } from "./PostHeader";
import { PostList } from "./PostList";
import { ReadToggle } from "./ReadToggle";

const post = {
  id: "welcome",
  collection: "blog",
  body: "Hello",
  data: {
    title: "Welcome",
    description: "First post",
    author: "Author",
    date: new Date("2026-01-01"),
    status: "published",
    tags: [],
  },
} satisfies CollectionEntry<"blog">;

test("post list omits drafts and unlisted posts", () => {
  render(
    <PostList
      posts={[
        post,
        {
          ...post,
          id: "draft",
          data: { ...post.data, title: "Draft", status: "draft" },
        },
        {
          ...post,
          id: "unlisted",
          data: { ...post.data, title: "Unlisted", status: "unlisted" },
        },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "Welcome" })).toHaveAttribute(
    "href",
    "/welcome",
  );
  expect(screen.queryByRole("link", { name: "Draft" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Unlisted" }),
  ).not.toBeInTheDocument();
});
test("post header renders the heading, author, date and reading time", () => {
  render(<PostHeader post={post} minutes={1} />);
  expect(
    screen.getByRole("heading", { level: 1, name: "Welcome" }),
  ).toBeInTheDocument();
  expect(screen.getByText(/Author/)).toHaveTextContent(
    "2026-01-01 · 1 min read",
  );
});
test("the island toggles read state accessibly", () => {
  render(<ReadToggle />);
  fireEvent.click(
    screen.getByRole("button", { name: "Mark as read", pressed: false }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Marked as read", pressed: true }),
  );
  expect(
    screen.getByRole("button", { name: "Mark as read", pressed: false }),
  ).toBeInTheDocument();
});
