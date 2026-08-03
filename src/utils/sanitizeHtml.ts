export interface HtmlSanitizerPolicy {
  allowedTags: ReadonlySet<string>;
  allowedAttributes?: Readonly<Record<string, ReadonlySet<string>>>;
  dropContentTags?: ReadonlySet<string>;
  afterSanitizeElement?: (element: Element) => void;
}

const DEFAULT_DROP_CONTENT_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FORM",
  "TEMPLATE",
  "NOSCRIPT",
]);
const EMPTY_ATTRIBUTES = new Set<string>();
// Reuse the parser for synchronous recomputations; parseFromString returns an isolated document.
const htmlParser = new DOMParser();

export function parseHtmlFragment(html: string): { document: Document; root: Element } | null {
  const document = htmlParser.parseFromString(`<div>${html}</div>`, "text/html");
  const root = document.body.firstElementChild;
  return root ? { document, root } : null;
}

export function sanitizeHtmlFragment(rawHtml: string, policy: HtmlSanitizerPolicy): string {
  const fragment = parseHtmlFragment(rawHtml);
  if (!fragment) return "";
  const { root } = fragment;
  const dropContentTags = policy.dropContentTags ?? DEFAULT_DROP_CONTENT_TAGS;
  const globalAttributes = policy.allowedAttributes?.["*"] ?? EMPTY_ATTRIBUTES;

  for (const element of Array.from(root.querySelectorAll("*"))) {
    const tagName = element.tagName.toUpperCase();
    if (!policy.allowedTags.has(tagName)) {
      if (dropContentTags.has(tagName)) {
        element.remove();
      } else {
        element.replaceWith(...Array.from(element.childNodes));
      }
      continue;
    }

    const tagAttributes = policy.allowedAttributes?.[tagName] ?? EMPTY_ATTRIBUTES;
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        (!globalAttributes.has(name) && !tagAttributes.has(name))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    policy.afterSanitizeElement?.(element);
  }

  return root.innerHTML;
}
