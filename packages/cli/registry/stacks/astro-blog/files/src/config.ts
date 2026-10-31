export const site = {
  title: "Field notes",
  description: "Notes from building and learning.",
  url: "https://example.com",
  author: "The author",
  image: "/default-og.svg",
  nav: [
    { label: "Home", href: "/" },
    { label: "RSS", href: "/rss.xml" },
  ],
};

if (!["https:", "http:"].includes(new URL(site.url).protocol)) {
  throw new Error("Set site.url to an absolute HTTP or HTTPS production URL.");
}
