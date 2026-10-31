import rss from "@astrojs/rss";
import { site } from "../config";
import { getPublishedPosts } from "../lib/collection";
import { slugFor } from "../lib/posts";

export async function GET() {
  return rss({
    title: site.title,
    description: site.description,
    site: site.url,
    trailingSlash: false,
    items: (await getPublishedPosts()).map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.date,
      link: `/${slugFor(post)}`,
    })),
  });
}
