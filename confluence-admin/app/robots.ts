import type { MetadataRoute } from "next";

// Nothing on the admin site should ever be crawled.
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
