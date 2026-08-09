const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const APP_PATH = path.resolve(__dirname, "app.js");

function classSet(el) {
  return new Set(String(el.className).split(/\s+/).filter(Boolean));
}

function matches(el, selector) {
  if (!el || !selector) return false;
  const parts = selector.split(/(?=[.#\[])/);
  for (const p of parts) {
    if (p.startsWith(".")) {
      if (!el.classList.contains(p.slice(1))) return false;
    } else if (p.startsWith("#")) {
      if (el.id !== p.slice(1)) return false;
    } else if (p.startsWith("[") && p.endsWith("]")) {
      const [name, value] = p.slice(1, -1).split("=");
      if (value !== undefined) {
        const v = value.replace(/^["']|["']$/g, "");
        if (el.getAttribute(name) !== v) return false;
      } else {
        if (!el.hasAttribute(name)) return false;
      }
    } else if (p !== "*" && el.tagName.toLowerCase() !== p.toLowerCase()) {
      return false;
    }
  }
  return true;
}

class MockClassList {
  constructor(el) {
    this.el = el;
    this._tokens = new Set();
    this._refresh();
  }
  _refresh() {
    this._tokens = new Set(String(this.el._className).split(/\s+/).filter(Boolean));
  }
  _save() {
    this.el._className = [...this._tokens].join(" ");
  }
  add(...tokens) {
    for (const t of tokens) this._tokens.add(String(t));
    this._save();
  }
  remove(...tokens) {
    for (const t of tokens) this._tokens.delete(String(t));
    this._save();
  }
  contains(token) {
    this._refresh();
    return this._tokens.has(String(token));
  }
  toggle(token, force) {
    const t = String(token);
    if (force === undefined) {
      if (this.contains(t)) {
        this.remove(t);
        return false;
      }
      this.add(t);
      return true;
    }
    if (force) {
      this.add(t);
      return true;
    }
    this.remove(t);
    return false;
  }
  toString() {
    this._refresh();
    return [...this._tokens].join(" ");
  }
  [Symbol.iterator]() {
    this._refresh();
    return this._tokens[Symbol.iterator]();
  }
}

class MockElement {
  constructor(tag, attrs = {}) {
    this.tagName = String(tag).toUpperCase();
    this._attrs = {};
    this._children = [];
    this._parent = null;
    this._listeners = new Map();
    this._className = "";
    this._style = {};
    this._text = "";
    this._html = "";
    this._played = 0;
    this._paused = 0;
    this._scrolled = false;
    this._loaded = false;
    this._focused = false;
    this.complete = false;
    if (this.tagName === "IMG") this.complete = true;

    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") this.className = v;
      else if (k === "text") this.textContent = v;
      else if (k === "html") this.innerHTML = v;
      else this.setAttribute(k, v);
    }
  }

  get className() { return this._className; }
  set className(value) { this._className = String(value || ""); }
  get classList() {
    if (!this._classList) this._classList = new MockClassList(this);
    return this._classList;
  }
  get id() { return this._attrs.id || ""; }
  get style() { return this._style; }
  get children() { return this._children; }
  get parentNode() { return this._parent; }
  set parentNode(value) { this._parent = value; }
  get textContent() { return this._text; }
  set textContent(value) { this._text = String(value || ""); }
  get innerHTML() { return this._html; }
  set innerHTML(value) { this._html = String(value || ""); }
  get firstChild() { return this._children[0] || null; }
  get nextSibling() {
    if (!this._parent) return null;
    const i = this._parent._children.indexOf(this);
    return this._parent._children[i + 1] || null;
  }
  get src() { return this._attrs.src || ""; }
  set src(value) {
    this._attrs.src = String(value || "");
    if (this.tagName === "IMG") this.complete = true;
  }
  get href() { return this._attrs.href || null; }
  set href(value) {
    if (value == null) delete this._attrs.href;
    else this._attrs.href = String(value);
  }

  setAttribute(name, value) { this._attrs[name] = String(value); }
  getAttribute(name) { return this._attrs[name] ?? null; }
  hasAttribute(name) { return name in this._attrs; }
  removeAttribute(name) { delete this._attrs[name]; }

  appendChild(child) {
    if (!(child instanceof MockElement)) return child;
    if (child._parent) child._parent.removeChild(child);
    this._children.push(child);
    child._parent = this;
    return child;
  }
  removeChild(child) {
    const i = this._children.indexOf(child);
    if (i !== -1) {
      this._children.splice(i, 1);
      child._parent = null;
    }
    return child;
  }
  replaceChild(newChild, oldChild) {
    const i = this._children.indexOf(oldChild);
    if (i === -1) return oldChild;
    if (newChild._parent) newChild._parent.removeChild(newChild);
    this._children[i] = newChild;
    newChild._parent = this;
    oldChild._parent = null;
    return oldChild;
  }
  replaceWith(newChild) {
    if (!this._parent) return;
    this._parent.replaceChild(newChild, this);
  }
  insertBefore(child, before) {
    if (child._parent) child._parent.removeChild(child);
    const i = this._children.indexOf(before);
    if (i === -1) this._children.push(child);
    else this._children.splice(i, 0, child);
    child._parent = this;
    return child;
  }

  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    if (this._listeners.has(type)) this._listeners.get(type).delete(fn);
  }
  dispatchEvent(event) {
    if (typeof event === "string") event = { type: event, target: this };
    else if (!event.target) event.target = this;

    const handlers = this._listeners.get(event.type);
    if (handlers) {
      for (const fn of handlers) fn.call(this, event);
    }
    const onProp = this["on" + event.type];
    if (typeof onProp === "function") onProp.call(this, event);
    for (const child of this._children) child.dispatchEvent(event);
  }

  querySelector(sel) {
    if (matches(this, sel)) return this;
    for (const child of this._children) {
      const found = child.querySelector(sel);
      if (found) return found;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    if (matches(this, sel)) out.push(this);
    for (const child of this._children) out.push(...child.querySelectorAll(sel));
    return out;
  }

  contains(node) {
    let n = node;
    while (n) {
      if (n === this) return true;
      n = n._parent;
    }
    return false;
  }

  scrollIntoView(options) {
    this._scrolled = options || true;
  }
  play() {
    this._played += 1;
    return Promise.resolve();
  }
  pause() { this._paused += 1; }
  load() { this._loaded = true; }
  focus() { this._focused = true; }
  blur() { this._focused = false; }
  click() { this.dispatchEvent({ type: "click", target: this }); }
}

class MockSVGElement extends MockElement {}

class MockDocument extends MockElement {
  constructor() {
    super("document");
    this.readyState = "loading";
    this.hidden = false;
    this.body = null;
    this._window = null;
  }
  getElementById(id) {
    return this.querySelector(`#${id}`);
  }
  createElementNS(ns, tag) {
    const svgTags = new Set([
      "svg", "path", "g", "use", "text", "view", "title", "desc", "defs", "clipPath", "mask", "pattern",
      "rect", "circle", "line", "polyline", "polygon", "ellipse", "linearGradient", "stop"
    ]);
    if (svgTags.has(tag)) return new MockSVGElement(tag);
    return this.createElement(tag);
  }
  createElement(tag) {
    if (tag === "img") {
      const el = new MockElement("img");
      el.complete = true;
      return el;
    }
    if (tag === "video") {
      const el = new MockElement("video");
      el._played = 0;
      el._paused = 0;
      return el;
    }
    return new MockElement(tag);
  }
  addEventListener(type, fn) {
    super.addEventListener(type, fn);
    this._docListeners = this._docListeners || {};
    this._docListeners[type] = this._docListeners[type] || new Set();
    this._docListeners[type].add(fn);
  }
  dispatchDocEvent(event) {
    if (typeof event === "string") event = { type: event, target: this };
    const listeners = this._docListeners && this._docListeners[event.type];
    if (listeners) for (const fn of listeners) fn.call(this, event);
  }
}

function createMockWindow(doc) {
  let reduced = false;
  return {
    location: { protocol: "http:", host: "localhost" },
    __CONFIG__: { API_BASE_URL: "/api", RESUME_ID: 192 },
    matchMedia(query) {
      return { matches: query === "(prefers-reduced-motion: reduce)" && reduced };
    },
    get reducedMotion() { return reduced; },
    set reducedMotion(value) { reduced = Boolean(value); },
    addEventListener(type, fn) {
      doc.addEventListener(type, fn);
    },
    removeEventListener(type, fn) {
      doc.removeEventListener(type, fn);
    },
    dispatchEvent(event) {
      doc.dispatchEvent(event);
    },
  };
}

function createMockFetch() {
  return async (url, opts = {}) => ({
    ok: true,
    status: 200,
    async json() { return { body: [] }; },
  });
}

class MockWebSocket {
  constructor(url) { this.url = url; }
  addEventListener() {}
  removeEventListener() {}
  send() {}
  close() {}
}

function setup() {
  const doc = new MockDocument();
  const win = createMockWindow(doc);
  doc._window = win;

  const body = new MockElement("body");
  const header = new MockElement("header", { class: "bg-gray-50" });
  const main = new MockElement("main", { class: "flex-1 min-h-0 flex flex-col py-6 px-6 sm:px-12 md:px-24" });
  const grid = new MockElement("div", { class: "relative grid h-full grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8" });
  const overlay = new MockElement("div", {
    id: "projectsPlaceholderOverlay",
    class: "overlay-placeholder absolute w-full grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-8 bg-white overflow-hidden transition-opacity duration-300 opacity-100",
  });

  grid.appendChild(overlay);
  main.appendChild(grid);
  body.appendChild(header);
  body.appendChild(main);
  doc.appendChild(body);
  doc.body = body;

  global.window = win;
  global.document = doc;
  global.SVGElement = MockSVGElement;
  global.fetch = createMockFetch();
  global.WebSocket = MockWebSocket;

  if (require.cache[APP_PATH]) delete require.cache[APP_PATH];
  const app = require(APP_PATH);

  return { app, doc, win, body, header, main, grid, overlay };
}

test("DOM test infrastructure loads app module with mock DOM", () => {
  const { app } = setup();
  assert.ok(app, "app module should export an object");
});

test("project video URL is allow-listed before src", () => {
  const { app } = setup();
  const validProject = { id: 1, project_name: "Valid", video: "https://example.com/video.mp4" };
  const { video, safeVideoUrl } = app.createProjectCard(validProject, {}, {});
  assert.ok(video, "valid video project should have a video element");
  assert.strictEqual(safeVideoUrl, "https://example.com/video.mp4", "safeVideoUrl should be set to an allowed URL");
  assert.strictEqual(video.src, "", "video src should not be set until the card is expanded");

  const invalidProject = { id: 2, project_name: "Invalid", video: "javascript:alert(1)" };
  const { video: video2, safeVideoUrl: safeVideoUrl2 } = app.createProjectCard(invalidProject, {}, {});
  assert.ok(video2, "invalid video project should still keep a video element placeholder");
  assert.strictEqual(safeVideoUrl2, null, "unsafe video URL should not pass the allow-list");
  assert.strictEqual(video2.src, "", "video src should remain empty for an invalid URL");
});

test("collapsed card image and title are not links", () => {
  const { app } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, img, contentDiv } = app.createProjectCard(project, {}, {});
  assert.notStrictEqual(img.parentNode.tagName, "A", "image should not be inside an a tag when collapsed");
  const h3 = contentDiv.querySelector("h3");
  assert.ok(h3, "title heading should exist");
  assert.notStrictEqual(h3.parentNode.tagName, "A", "title heading should not be inside an a tag when collapsed");
  assert.strictEqual(card.getAttribute("role"), "button", "collapsed card should have role button");
  assert.strictEqual(card.getAttribute("tabindex"), "0", "collapsed card should be keyboard focusable");
  assert.strictEqual(card.getAttribute("aria-expanded"), "false", "collapsed card should have aria-expanded false");
  assert.strictEqual(card.getAttribute("data-project-id"), "1", "card should carry its project id");
});

test("only one project card is expanded at a time", () => {
  const { app, doc } = setup();
  const first = { id: 1, project_name: "First", project_link: "https://example.com/first" };
  const second = { id: 2, project_name: "Second", project_link: "https://example.com/second" };
  const { card: card1 } = app.createProjectCard(first, {}, {});
  const { card: card2 } = app.createProjectCard(second, {}, {});

  card1.click();
  assert.strictEqual(card1.getAttribute("aria-expanded"), "true", "first card should be expanded");
  assert.strictEqual(card2.getAttribute("aria-expanded"), "false", "second card should still be collapsed");

  card2.click();
  assert.strictEqual(card1.getAttribute("aria-expanded"), "false", "first card should collapse when second expands");
  assert.strictEqual(card2.getAttribute("aria-expanded"), "true", "second card should be expanded");
});

test("click outside grid collapses expanded card", () => {
  const { app, doc, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card } = app.createProjectCard(project, {}, {});
  card.click();
  assert.strictEqual(card.getAttribute("aria-expanded"), "true");

  const outside = new MockElement("div");
  doc.dispatchEvent({ type: "click", target: outside });
  assert.strictEqual(card.getAttribute("aria-expanded"), "false", "expanded card should collapse on outside click");
});

test("expanded card spans full grid row and uses flex layout", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, mediaWrapper, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.ok(card.classList.contains("col-span-full"), "expanded card should span full grid column");
  assert.ok(card.classList.contains("h-full"), "expanded card should fill the grid track");
  assert.ok(card.classList.contains("lg:flex-row") || card.querySelector("article").classList.contains("lg:flex-row"), "expanded card should use a row flex layout on large screens");
  assert.ok(mediaWrapper.classList.contains("h-1/2") || mediaWrapper.classList.contains("lg:h-full"), "media wrapper should have a defined height");
  assert.ok(contentDiv.classList.contains("h-1/2") || contentDiv.classList.contains("lg:h-full"), "content wrapper should have a defined height");
  assert.ok(contentDiv.classList.contains("overflow-y-auto"), "content wrapper should scroll when overflowing");
  assert.ok(String(grid.style.gridTemplateRows).includes("1fr"), "grid should have a 1fr row for the expanded card");
});

test("video lazy-loads on expand and falls back to image on error", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video: "https://example.com/video.mp4" };
  const { card, img, video } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.strictEqual(video.src, "https://example.com/video.mp4", "video src should be set lazily on expand");
  assert.ok(!img.classList.contains("hidden"), "image should be visible while video is loading");
  assert.ok(video.classList.contains("hidden"), "video should be hidden while it is loading");

  const spinner = card.querySelector(".absolute.inset-0");
  assert.ok(spinner, "spinner element should exist");
  assert.ok(!spinner.classList.contains("hidden"), "spinner should be visible while video is loading");

  video.dispatchEvent("canplay");
  assert.ok(img.classList.contains("hidden"), "image should be hidden when video can play");
  assert.ok(!video.classList.contains("hidden"), "video should be shown on canplay");
  assert.ok(video._played > 0, "video should attempt to play when it can");

  const errorProject = { id: 2, project_name: "E", project_link: "https://example.com/project", video: "https://example.com/video.mp4" };
  const { card: card2, img: img2, video: video2 } = app.createProjectCard(errorProject, {}, {});
  grid.appendChild(card2);
  card2.click();
  assert.strictEqual(video2.src, "https://example.com/video.mp4");
  video2.dispatchEvent("error");
  assert.ok(!img2.classList.contains("hidden"), "image should remain visible on video error");
  assert.ok(video2.classList.contains("hidden"), "video should remain hidden on error");
});

test("clicking a collapsed card expands it", () => {
  const { app } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  assert.strictEqual(card.getAttribute("aria-expanded"), "false");
  card.click();
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "card should have aria-expanded true after click");
  const h3 = contentDiv.querySelector("h3");
  assert.strictEqual(h3.parentNode.tagName, "A", "title should be wrapped in a link after expand");
  assert.strictEqual(h3.parentNode.getAttribute("href"), "https://example.com/project", "title link should point to the project link");
});

test("index.html has flex viewport layout", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
  assert.ok(/<body[^>]*class="[^"]*flex flex-col min-h-dvh[^"]*"/.test(html), "body should be a flex column with min-h-dvh");
  assert.ok(/<header[^>]*class="[^"]*flex-shrink-0[^"]*"/.test(html), "header should be flex-shrink-0");
  assert.ok(/<main[^>]*class="[^"]*flex-1[^"]*"/.test(html), "main wrapper should be flex-1");
  assert.ok(/class="[^"]*relative grid h-full[^"]*"/.test(html), "inner grid should be h-full");
});
