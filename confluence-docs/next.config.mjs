import nextra from "nextra";

// Confluence docs (docs.confluencebuild.xyz). Setup follows https://nextra.site/docs/docs-theme/start
// (confluence:docs-site)
const withNextra = nextra({
  search: { codeblocks: false },
});

export default withNextra({
  poweredByHeader: false,
  reactStrictMode: true,
});
