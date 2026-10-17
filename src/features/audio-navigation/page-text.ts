const EXCLUDED = '[data-audio-navigation], [data-audio-private], [hidden], [inert], [aria-hidden="true"], script, style, noscript';
export function isReadable(element: Element): boolean {
  if (element.closest(EXCLUDED)) return false;
  const style = getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
}
export function readableText(root: Element): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: string[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    if (node.parentElement && !node.parentElement.closest('input, textarea, select, [contenteditable="true"]') && isReadable(node.parentElement)) {
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (text) chunks.push(text);
    }
  }
  return chunks.join(". ").slice(0, 20_000);
}
export function controlDescription(element: HTMLElement): string {
  if (!isReadable(element) || element.closest('[data-audio-navigation]')) return "";
  const labelled = element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
  const label = labelled || element.getAttribute("aria-label") ||
    ("labels" in element ? Array.from((element as HTMLInputElement).labels ?? []).map((el) => el.textContent).join(" ") : "") ||
    (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) ? element.textContent : "");
  const role = element.getAttribute("role") || (element instanceof HTMLInputElement
    ? (["checkbox", "radio"].includes(element.type) ? element.type : "text field")
    : element instanceof HTMLTextAreaElement ? "text field"
    : element instanceof HTMLSelectElement ? "selection" : element.tagName === "A" ? "link" : element.tagName.toLowerCase());
  const description = element.getAttribute("aria-describedby")?.split(/\s+/)
    .map((id) => document.getElementById(id))
    .filter((node): node is HTMLElement => !!node && isReadable(node))
    .map((node) => node.textContent).join(" ");
  const required = element.getAttribute("aria-required") === "true" || element.hasAttribute("required");
  const invalid = element.getAttribute("aria-invalid") === "true";
  const disabled = element.getAttribute("aria-disabled") === "true" || element.hasAttribute("disabled");
  const checked = element.getAttribute("aria-checked") ??
    (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type) ? String(element.checked) : null);
  const expanded = element.getAttribute("aria-expanded");
  // Never use .value: names, addresses, credentials and free text stay unspoken on focus.
  return [label?.trim(), role, checked === null ? "" : checked === "true" ? "checked" : "not checked",
    expanded === null ? "" : expanded === "true" ? "expanded" : "collapsed",
    required ? "required" : "", invalid ? "invalid entry" : "", disabled ? "unavailable" : "", description].filter(Boolean).join(". ").slice(0, 500);
}
