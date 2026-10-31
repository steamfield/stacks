import type { CollectionEntry } from "astro:content";
import { publishedPosts, slugFor } from "../lib/posts";

export function PostList({
  posts,
}: {
  posts: ReadonlyArray<CollectionEntry<"blog">>;
}) {
  return (
    <ul>
      {publishedPosts(posts).map((post) => (
        <li key={post.id} className="mb-6">
          <a className="text-xl underline" href={`/${slugFor(post)}`}>
            {post.data.title}
          </a>
          <p>{post.data.description}</p>
          <time dateTime={post.data.date.toISOString()}>
            {post.data.date.toISOString().slice(0, 10)}
          </time>
        </li>
      ))}
    </ul>
  );
}
