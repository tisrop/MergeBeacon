interface CssDeclarations {
  [property: string]: string;
}

const dynamicRules = new Map<string, string>();
const staticClassNames = new Map<string, string>();
let dynamicClassSequence = 0;
let stylesheet: HTMLStyleElement | null = null;
const documentStateClassCounts = new Map<string, number>();

function isSafeProperty(property: string): boolean {
  return /^(?:--[a-z0-9-]+|[a-z-]+)$/i.test(property);
}

function isSafeValue(value: string): boolean {
  return /^[#(),.%\s/+\-a-z0-9]+$/i.test(value);
}

function serializeDeclarations(declarations: CssDeclarations): string {
  return Object.entries(declarations)
    .map(([property, value]) => {
      if (!isSafeProperty(property) || !isSafeValue(value)) {
        throw new Error(`不安全的动态 CSS 声明：${property}`);
      }
      return `${property}: ${value};`;
    })
    .join(" ");
}

function ensureStylesheet(): HTMLStyleElement | null {
  if (typeof document === "undefined") return null;
  if (stylesheet?.isConnected) return stylesheet;

  stylesheet = document.querySelector<HTMLStyleElement>("style[data-mergebeacon-dynamic-css]");
  if (stylesheet) return stylesheet;

  stylesheet = document.createElement("style");
  stylesheet.dataset.mergebeaconDynamicCss = "";
  document.head.append(stylesheet);
  return stylesheet;
}

function renderRules(): void {
  const target = ensureStylesheet();
  if (!target) return;
  target.textContent = [...dynamicRules.entries()]
    .map(([selector, declarations]) => `${selector} { ${declarations} }`)
    .join("\n");
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function normalizePrefix(prefix: string): string {
  return prefix.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

export interface DynamicCssClass {
  className: string;
  update: (declarations: CssDeclarations) => void;
  dispose: () => void;
}

/**
 * Keeps component-specific dynamic layout values in a dedicated stylesheet instead of Vue template
 * style bindings. Use only for measured geometry that cannot be represented by a semantic class.
 */
export function createDynamicCssClass(prefix: string): DynamicCssClass {
  const className = `mb-dynamic-${normalizePrefix(prefix)}-${dynamicClassSequence++}`;
  const selector = `.${className}`;

  return {
    className,
    update(declarations) {
      dynamicRules.set(selector, serializeDeclarations(declarations));
      renderRules();
    },
    dispose() {
      if (dynamicRules.delete(selector)) renderRules();
    },
  };
}

/** Registers a reusable, deterministic class for a trusted static CSS declaration. */
export function getStaticCssClass(prefix: string, declarations: CssDeclarations): string {
  const serialized = serializeDeclarations(declarations);
  const key = `${normalizePrefix(prefix)}:${serialized}`;
  const existing = staticClassNames.get(key);
  if (existing) return existing;

  const className = `mb-static-${normalizePrefix(prefix)}-${hash(key)}`;
  staticClassNames.set(key, className);
  dynamicRules.set(`.${className}`, serialized);
  renderRules();
  return className;
}

/** Applies a global interaction state through a CSS class rather than document.body.style. */
export function useDocumentStateClass(className: string): () => void {
  if (typeof document === "undefined") return () => undefined;

  const activeCount = documentStateClassCounts.get(className) ?? 0;
  documentStateClassCounts.set(className, activeCount + 1);
  document.documentElement.classList.add(className);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const nextCount = Math.max(0, (documentStateClassCounts.get(className) ?? 1) - 1);
    if (nextCount === 0) {
      documentStateClassCounts.delete(className);
      document.documentElement.classList.remove(className);
    } else {
      documentStateClassCounts.set(className, nextCount);
    }
  };
}
