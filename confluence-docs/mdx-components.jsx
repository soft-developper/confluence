import { useMDXComponents as getThemeComponents } from "nextra-theme-docs";

// Theme components for every MDX page (https://nextra.site/docs/file-conventions/mdx-components-file).
const themeComponents = getThemeComponents();

export function useMDXComponents(components) {
  return { ...themeComponents, ...components };
}
