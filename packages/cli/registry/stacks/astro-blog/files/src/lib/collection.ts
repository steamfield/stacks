import { getCollection } from "astro:content";
import { publishedPosts, routablePosts } from "./posts";

export async function getPublishedPosts() {
  return publishedPosts(await getCollection("blog"));
}

export async function getRoutablePosts() {
  return routablePosts(await getCollection("blog"), import.meta.env.DEV);
}
