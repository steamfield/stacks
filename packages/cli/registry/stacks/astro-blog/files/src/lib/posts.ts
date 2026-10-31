type Post = {
  id: string;
  data: { status: "draft" | "published" | "unlisted"; date: Date };
};

export function slugFor(entry: Pick<Post, "id">): string {
  return entry.id.replace(/\.(md|mdx)$/i, "").replace(/\/index$/, "");
}

export function publishedPosts<T extends Post>(entries: ReadonlyArray<T>): T[] {
  return entries
    .filter((entry) => entry.data.status === "published")
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export function routablePosts<T extends Post>(
  entries: ReadonlyArray<T>,
  dev: boolean,
): T[] {
  return entries.filter((entry) => dev || entry.data.status !== "draft");
}

export function readingTime(body: string): number {
  return Math.max(
    1,
    Math.ceil(body.trim().split(/\s+/).filter(Boolean).length / 200),
  );
}
