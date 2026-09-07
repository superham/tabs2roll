// A tiny fake DOM for testing the page extractors under Node: just the few
// features the extractors use (querySelector(All) with simple selectors,
// children, innerText/textContent, getAttribute, title, location).

const BLOCK = new Set(["DIV", "P", "PRE", "SECTION", "ARTICLE", "MAIN", "BODY", "H1", "H2", "H3", "LI", "UL", "OL", "TR", "TABLE", "HEADER", "FOOTER", "NAV"]);

export function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    attrs: { ...attrs },
    childNodes: children.map((c) => (typeof c === "string" ? { text: c } : c)),
    get children() {
      return this.childNodes.filter((c) => c.tagName);
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
    },
    get textContent() {
      return this.childNodes.map((c) => (c.tagName ? c.textContent : c.text)).join("");
    },
    get innerText() {
      if (this.tagName === "SCRIPT" || this.tagName === "STYLE") return "";
      if (this.tagName === "BR") return "\n";
      const inner = this.childNodes.map((c) => (c.tagName ? c.innerText : c.text)).join("");
      return BLOCK.has(this.tagName) ? inner.replace(/^\n?/, "") + "\n" : inner;
    },
    querySelectorAll(selector) {
      const out = [];
      walk(this, (n) => {
        if (n !== this && matches(n, selector)) out.push(n);
      });
      return out;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
  };
  return node;
}

function walk(node, fn) {
  fn(node);
  for (const c of node.children) walk(c, fn);
}

function matches(node, selectorList) {
  return selectorList.split(",").some((selector) => {
    const s = selector.trim();
    const m = /^([a-zA-Z0-9]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/.exec(s);
    if (!m) throw new Error("fake-dom: unsupported selector " + s);
    const [, tag, classes, attrs] = m;
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    for (const cls of classes.split(".").filter(Boolean)) {
      if (!(node.attrs.class || "").split(/\s+/).includes(cls)) return false;
    }
    for (const attr of attrs.match(/\[[^\]]+\]/g) || []) {
      const am = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(attr);
      if (!am) throw new Error("fake-dom: unsupported attribute selector " + attr);
      const value = node.getAttribute(am[1]);
      if (value === null) return false;
      if (am[2] !== undefined && value !== am[2]) return false;
    }
    return true;
  });
}

export function document({ hostname = "example.com", title = "", head = [], body = [] } = {}) {
  const headEl = el("head", {}, head);
  const bodyEl = el("body", {}, body);
  const html = el("html", {}, [headEl, bodyEl]);
  return {
    title,
    location: { hostname },
    body: bodyEl,
    head: headEl,
    documentElement: html,
    querySelectorAll: (s) => html.querySelectorAll(s),
    querySelector: (s) => html.querySelector(s),
  };
}
