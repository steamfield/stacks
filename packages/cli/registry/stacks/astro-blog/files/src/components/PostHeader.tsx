import type { CollectionEntry } from "astro:content";

export function PostHeader({
  post,
  minutes,
}: {
  post: CollectionEntry<"blog">;
  minutes: number;
}) {
  return (
    <header>
      <h1 className="text-3xl font-bold">{post.data.title}</h1>
      <p>
        {post.data.author} ·{" "}
        <time dateTime={post.data.date.toISOString()}>
          {post.data.date.toISOString().slice(0, 10)}
        </time>{" "}
        · {minutes} min read
      </p>
      {post.data.updated && (
        <p>
          Updated{" "}
          <time dateTime={post.data.updated.toISOString()}>
            {post.data.updated.toISOString().slice(0, 10)}
          </time>
        </p>
      )}
      {post.data.status !== "published" && <p>{post.data.status}</p>}
    </header>
  );
}
