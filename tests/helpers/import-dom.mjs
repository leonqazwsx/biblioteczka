export function importDom() {
  const doc = { activeElement: null };
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.parent = null;
      this.attributes = new Map();
      this.dataset = {};
      this.type = '';
      this.disabled = false;
      this.value = '';
      this._text = '';
      this.connected = false;
      this.className = '';
      this.classList = { add: (name) => (this.className += ' ' + name) };
    }
    get isConnected() {
      return this.connected || !!this.parent?.isConnected;
    }
    set textContent(value) {
      this.children = [];
      this._text = String(value);
    }
    get textContent() {
      return this._text + this.children.map((c) => c.textContent).join('');
    }
    set innerHTML(value) {
      throw new Error('HTML injection is forbidden in preview');
    }
    append(...nodes) {
      for (const node of nodes) {
        if (typeof node !== 'object') throw new Error('Use textContent');
        node.parent = this;
        this.children.push(node);
      }
    }
    replaceChildren(...nodes) {
      for (const child of this.children) child.parent = null;
      this.children = [];
      this._text = '';
      this.append(...nodes);
    }
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    }
    getAttribute(name) {
      return this.attributes.get(name) ?? null;
    }
    contains(node) {
      return this === node || this.children.some((child) => child.contains(node));
    }
    querySelectorAll(selector) {
      const tags = selector.split(',').map((v) => v.trim().toUpperCase());
      const result = [];
      function walk(node) {
        for (const child of node.children) {
          if (tags.includes(child.tagName)) result.push(child);
          walk(child);
        }
      }
      walk(this);
      return result;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    }
    closest() {
      return null;
    }
    focus() {
      doc.activeElement = this;
    }
  }
  doc.createElement = (tag) => new Element(tag);
  const root = doc.createElement('section');
  root.connected = true;
  return { doc, root };
}
