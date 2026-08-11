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

  remove() {
    if (this._parent) this._parent.removeChild(this);
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

    let stopped = false;
    if (!event.stopPropagation) {
      event.stopPropagation = () => { stopped = true; };
    }
    const originalStop = event.stopPropagation;
    event.stopPropagation = () => { stopped = true; originalStop.call(event); };

    if (!event.preventDefault) event.preventDefault = () => {};

    const handlers = this._listeners.get(event.type);
    if (handlers) {
      for (const fn of handlers) {
        if (stopped) break;
        fn.call(this, event);
      }
    }
    const onProp = this["on" + event.type];
    if (!stopped && typeof onProp === "function") onProp.call(this, event);

    if (!stopped && this._parent) {
      this._parent.dispatchEvent(event);
    }
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
  const win = {
    location: { protocol: "http:", host: "localhost" },
    __CONFIG__: { API_BASE_URL: "/api", RESUME_ID: 192 },
    _opened: null,
    _openTarget: null,
    open(url, target) { win._opened = url; win._openTarget = target; },
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
  return win;
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

test("project image is contained, square, and centered", () => {
  const { app } = setup();
  const project = { id: 1, project_name: "P", image_url: "https://example.com/image.png" };
  const { img, mediaWrapper } = app.createProjectCard(project, {}, {});
  assert.ok(img.classList.contains("object-contain"), "image should use object-contain");
  assert.ok(img.classList.contains("object-center"), "image should be centered");
  assert.ok(mediaWrapper.classList.contains("aspect-square"), "media wrapper should have a square aspect ratio");
  assert.ok(mediaWrapper.classList.contains("items-center"), "media wrapper should center the image vertically");
  assert.ok(mediaWrapper.classList.contains("justify-center"), "media wrapper should center the image horizontally");
});

test("project video URL is allow-listed before src", () => {
  const { app } = setup();

  const validProject = { id: 1, project_name: "Valid", video_url: "https://example.com/video.mp4" };
  const { video, safeVideoUrl } = app.createProjectCard(validProject, {}, {});
  assert.ok(video, "valid video project should have a video element");
  assert.strictEqual(safeVideoUrl, "https://example.com/video.mp4", "safeVideoUrl should be set to an allowed URL");
  assert.strictEqual(video.src, "", "video src should not be set until the card is expanded");

  const invalidProject = { id: 3, project_name: "Invalid", video_url: "javascript:alert(1)" };
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
  grid.appendChild(card);
  card.click();
  assert.strictEqual(card.getAttribute("aria-expanded"), "true");

  const outside = new MockElement("div");
  doc.appendChild(outside);
  outside.dispatchEvent({ type: "click", target: outside });
  assert.strictEqual(card.getAttribute("aria-expanded"), "false", "expanded card should collapse on outside click");
});

test("clicking expanded title link does not collapse card and preserves href", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, titleLink } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.strictEqual(card.getAttribute("aria-expanded"), "true");
  assert.strictEqual(titleLink.getAttribute("href"), "https://example.com/project", "title link should have the project href");

  titleLink.dispatchEvent({ type: "click", target: titleLink });
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "card should stay expanded when title link is clicked");
  assert.strictEqual(titleLink.getAttribute("href"), "https://example.com/project", "title link href should be preserved");
});

test("clicking expanded video does not collapse card", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card, video } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.strictEqual(card.getAttribute("aria-expanded"), "true");

  video.dispatchEvent({ type: "click", target: video });
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "card should stay expanded when video is clicked");
});

test("expanded card spans full grid row and uses flex layout", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, mediaWrapper, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.ok(card.classList.contains("col-span-full"), "expanded card should span full grid column");
  assert.ok(card.classList.contains("h-[calc(100dvh-4rem)]"), "expanded card should fill viewport minus top and bottom margin");
  assert.ok(card.classList.contains("lg:flex-row") || card.querySelector("article").classList.contains("lg:flex-row"), "expanded card should use a row flex layout on large screens");
  assert.ok(mediaWrapper.classList.contains("h-1/2") || mediaWrapper.classList.contains("lg:h-full"), "media wrapper should have a defined height");
  assert.ok(contentDiv.classList.contains("h-1/2") || contentDiv.classList.contains("lg:h-full"), "content wrapper should have a defined height");
  assert.ok(contentDiv.classList.contains("overflow-y-auto"), "content wrapper should scroll when overflowing");
  assert.ok(String(grid.style.gridTemplateRows).includes("1fr"), "grid should have a 1fr row for the expanded card");
});

test("video lazy-loads on expand and falls back to image on error", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
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

  const errorProject = { id: 2, project_name: "E", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card: card2, img: img2, video: video2 } = app.createProjectCard(errorProject, {}, {});
  grid.appendChild(card2);
  card2.click();
  assert.strictEqual(video2.src, "https://example.com/video.mp4");
  video2.dispatchEvent("error");
  assert.ok(!img2.classList.contains("hidden"), "image should remain visible on video error");
  assert.ok(video2.classList.contains("hidden"), "video should remain hidden on error");
});

test("video playback is controlled on expand, collapse, and visibility change", () => {
  const { app, doc, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card, video } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  assert.strictEqual(video.getAttribute("autoplay"), "true", "video should have autoplay attribute");
  assert.strictEqual(video.getAttribute("muted"), "true", "video should be muted");
  assert.strictEqual(video.getAttribute("controls"), "true", "video should have controls");
  assert.strictEqual(video.getAttribute("loop"), "true", "video should loop");

  card.click();
  assert.ok(video._played > 0, "play should be called when the card is expanded");

  card.click();
  assert.ok(video._paused > 0, "pause should be called when the card is collapsed");

  // Expand again, then hide the page
  card.click();
  doc.hidden = true;
  doc.dispatchEvent({ type: "visibilitychange" });
  assert.ok(video._paused > 1, "pause should be called when the page is hidden");
});

test("keyboard and reduced motion are supported", () => {
  const { app, win } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card, video } = app.createProjectCard(project, {}, {});

  assert.strictEqual(card.getAttribute("role"), "button", "collapsed card should have role button");
  assert.strictEqual(card.getAttribute("tabindex"), "0", "collapsed card should be focusable");
  assert.ok(card.classList.contains("focus:outline-none") || card.classList.contains("focus-visible:ring-2"), "card should have a focus-visible ring class");
  assert.ok(card.classList.contains("motion-reduce:transition-none"), "card should respect reduced motion for transitions");

  card.dispatchEvent({ type: "keydown", key: "Enter" });
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "Enter key should expand the card");

  card.dispatchEvent({ type: "keydown", key: " " });
  assert.strictEqual(card.getAttribute("aria-expanded"), "false", "Space key should collapse the expanded card");

  card.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.strictEqual(card.getAttribute("aria-expanded"), "false", "Escape should keep the card collapsed");

  card.dispatchEvent({ type: "keydown", key: "Enter" });
  win.reducedMotion = true;
  video._played = 0;
  card.dispatchEvent({ type: "keydown", key: "Enter" });
  card.click();
  assert.strictEqual(video._played, 0, "video play should not be called when reduced motion is preferred");
});

test("reduced motion pauses video on canplay", () => {
  const { app, win } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card, video, img } = app.createProjectCard(project, {}, {});

  win.reducedMotion = true;
  card.click();
  video._played = 0;
  video._paused = 0;
  video.dispatchEvent("canplay");

  assert.strictEqual(video._played, 0, "video play should not be called when reduced motion is preferred");
  assert.ok(video._paused > 0, "video should be paused on canplay under reduced motion");
});

test("expanded card scroll anchor adds top margin and scrolls into view", () => {
  const { app, grid, win } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, scrollAnchor } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  assert.ok(scrollAnchor, "card should have a scroll anchor");
  assert.ok(scrollAnchor.classList.contains("scroll-mt-8"), "scroll anchor should add a top margin when scrolling");

  card.click();
  assert.ok(scrollAnchor._scrolled, "scroll anchor should scroll into view when expanded");
  assert.strictEqual(scrollAnchor._scrolled.block, "start", "scroll should align to the top of the anchor");

  win.reducedMotion = true;
  scrollAnchor._scrolled = false;
  card.click();
  card.click();
  assert.strictEqual(scrollAnchor._scrolled.behavior, "auto", "reduced motion should use auto scroll behavior");
});

test("expanded card content scrolls independently", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.ok(contentDiv.classList.contains("overflow-y-auto"), "content wrapper should allow vertical scrolling");
  assert.ok(contentDiv.classList.contains("h-1/2") || contentDiv.classList.contains("lg:h-full"), "content wrapper should have a constrained height");
});

test("expanded content scales type and uses flex with pushed buttons", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
    description: "A short description.",
  };
  const techByProjectId = { 1: [{ technology_name: "JavaScript" }] };
  const { card, contentDiv, techWrap, projectBtn, sourceBtn } = app.createProjectCard(project, {}, techByProjectId);
  grid.appendChild(card);

  card.click();
  assert.ok(contentDiv.classList.contains("flex"), "content should use flex");
  assert.ok(contentDiv.classList.contains("flex-col"), "content should be a column flex container");
  assert.ok(contentDiv.classList.contains("min-h-0"), "content should allow shrinking");
  assert.ok(contentDiv.classList.contains("lg:p-8"), "content should have larger desktop padding");

  assert.ok(projectBtn.classList.contains("mt-auto"), "Live Demo button should push to bottom");
  assert.ok(projectBtn.classList.contains("self-start"), "buttons should not stretch");
  assert.ok(sourceBtn.classList.contains("self-start"), "buttons should not stretch");

  const h3 = contentDiv.querySelector("h3");
  assert.ok(h3.classList.contains("lg:text-2xl"), "title should scale up on desktop");

  const bodyPs = Array.from(contentDiv.querySelectorAll("p")).filter((p) => p.classList.contains("text-sm/relaxed"));
  assert.ok(bodyPs.length > 0, "body paragraphs should exist");
  for (const p of bodyPs) {
    assert.ok(p.classList.contains("lg:text-base"), "body text should scale up");
    assert.ok(p.classList.contains("lg:leading-relaxed"), "body text should use relaxed line height");
  }

  const techPs = Array.from(techWrap.querySelectorAll("p"));
  assert.ok(techPs.length > 0, "tech tags should exist");
  for (const p of techPs) {
    assert.ok(p.classList.contains("lg:text-base"), "tech tag text should scale up");
  }

  card.click();
  assert.ok(!contentDiv.classList.contains("flex"), "content should not be flex after collapse");
  assert.ok(!h3.classList.contains("lg:text-2xl"), "title should not have large class after collapse");
});

test("card has transition classes and re-layouts on resize", () => {
  const { app, grid, win } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project" };
  const { card } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  assert.ok(card.classList.contains("transition"), "card should have a transition class");

  card.click();
  assert.ok(card.classList.contains("shadow-2xl"), "expanded card should have an emphasized shadow");
  assert.ok(String(grid.style.gridTemplateRows).includes("1fr"), "grid should have a 1fr row");

  const second = { id: 2, project_name: "S", project_link: "https://example.com/second" };
  const { card: card2 } = app.createProjectCard(second, {}, {});
  grid.insertBefore(card2, card);

  win.dispatchEvent({ type: "resize" });
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "card should stay expanded after resize");
  assert.ok(String(grid.style.gridTemplateRows).includes("1fr"), "grid should still have a 1fr row after resize re-layout");
});

test("video uses object-contain within its half", () => {
  const { app } = setup();
  const project = { id: 1, project_name: "P", video_url: "https://example.com/video.mp4" };
  const { video } = app.createProjectCard(project, {}, {});
  assert.ok(video.classList.contains("object-contain"), "video should use object-contain");
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

test("generated css contains expanded card and image utilities", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "..", "css", "style.css"), "utf8");
  assert.ok(css.includes(".col-span-full"), "css should contain the custom col-span-full utility");
  assert.ok(css.includes(".min-h-dvh"), "css should contain min-h-dvh");
  assert.ok(css.includes(".focus-visible\\:ring-2"), "css should contain focus-visible ring utilities");
  assert.ok(css.includes(".motion-reduce\\:transition-none"), "css should contain motion-reduce transition utility");
  assert.ok(css.includes(".aspect-square"), "css should contain aspect-square");
  assert.ok(css.includes(".object-center"), "css should contain object-center");
  assert.ok(css.includes(".object-contain"), "css should contain object-contain");
  assert.ok(css.includes(".scroll-mt-8"), "css should contain scroll-mt-8");
  assert.ok(css.includes(".h-\\[calc\\(100dvh-4rem\\)\\]"), "css should contain h-[calc(100dvh-4rem)] for expanded card height");
});

test("index.html has flex viewport layout", () => {
  const html = fs.readFileSync(path.resolve(__dirname, "..", "index.html"), "utf8");
  assert.ok(/<body[^>]*class="[^"]*flex flex-col min-h-dvh[^"]*"/.test(html), "body should be a flex column with min-h-dvh");
  assert.ok(/<header[^>]*class="[^"]*flex-shrink-0[^"]*"/.test(html), "header should be flex-shrink-0");
  assert.ok(/<main[^>]*class="[^"]*flex-1[^"]*"/.test(html), "main wrapper should be flex-1");
  assert.ok(/class="[^"]*relative grid h-full[^"]*"/.test(html), "inner grid should be h-full");
});

test("overlay is rendered inside mediaWrapper when video_url exists", () => {
  const { app } = setup();
  const project = { id: 1, project_name: "P", video_url: "https://example.com/video.mp4" };
  const { mediaWrapper } = app.createProjectCard(project, {}, {});
  const overlay = mediaWrapper.querySelector(".z-10");
  assert.ok(overlay, "overlay should be present when video_url exists");
  assert.ok(overlay.classList.contains("bg-gray-900/60"), "overlay should be dark translucent");
  assert.ok(overlay.classList.contains("pointer-events-none"), "overlay should not capture clicks");
  const spinner = overlay.querySelector(".animate-spin");
  assert.ok(spinner, "overlay should contain a CSS-only spinner");
});

test("overlay fades in on expand and out on canplay or error", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card, overlay, video } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  assert.ok(overlay.classList.contains("opacity-0"), "overlay should be hidden when collapsed");

  card.click();
  assert.ok(overlay.classList.contains("opacity-100"), "overlay should be visible after expand");

  video.dispatchEvent("canplay");
  assert.ok(overlay.classList.contains("opacity-0"), "overlay should fade out on canplay");

  const errorProject = { id: 2, project_name: "E", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card: card2, overlay: overlay2, video: video2 } = app.createProjectCard(errorProject, {}, {});
  grid.appendChild(card2);
  card2.click();
  assert.ok(overlay2.classList.contains("opacity-100"), "overlay should be visible after expand");

  video2.dispatchEvent("error");
  assert.ok(overlay2.classList.contains("opacity-0"), "overlay should fade out on error");
});

test("overlay respects reduced motion and is absent without video_url", () => {
  const { app } = setup();
  const project = { id: 1, project_name: "P", video_url: "https://example.com/video.mp4" };
  const { mediaWrapper } = app.createProjectCard(project, {}, {});
  const overlay = mediaWrapper.querySelector(".z-10");

  assert.ok(overlay.classList.contains("transition-opacity"), "overlay should have an opacity transition");
  assert.ok(overlay.classList.contains("duration-300"), "overlay should have a 300ms transition");
  assert.ok(overlay.classList.contains("motion-reduce:transition-none"), "overlay should disable transitions for reduced motion");
  assert.ok(overlay.classList.contains("motion-reduce:duration-0"), "overlay should have zero duration for reduced motion");

  const noVideoProject = { id: 2, project_name: "NoVideo" };
  const { mediaWrapper: mediaWrapper2 } = app.createProjectCard(noVideoProject, {}, {});
  assert.strictEqual(mediaWrapper2.querySelector(".z-10"), null, "overlay should not exist without video_url");
});

test("old text spinner is not rendered", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  const oldSpinner = card.querySelector(".text-gray-500");
  assert.strictEqual(oldSpinner, null, "old 'Loading video…' text spinner should not exist");
});

test("overlay hides on collapse and ignores pause and visibilitychange", () => {
  const { app, grid, doc } = setup();
  const project = { id: 1, project_name: "P", project_link: "https://example.com/project", video_url: "https://example.com/video.mp4" };
  const { card, overlay, video } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);

  card.click();
  assert.ok(overlay.classList.contains("opacity-100"), "overlay should be visible after expand");

  card.click();
  assert.ok(overlay.classList.contains("opacity-0"), "overlay should be hidden after collapse");

  card.click();
  assert.ok(overlay.classList.contains("opacity-100"), "overlay should be visible after re-expand");

  video.dispatchEvent("canplay");
  assert.ok(overlay.classList.contains("opacity-0"), "overlay should be hidden after canplay");

  video.dispatchEvent("pause");
  assert.ok(overlay.classList.contains("opacity-0"), "pause should not show overlay");

  doc.hidden = true;
  doc.dispatchDocEvent("visibilitychange");
  assert.ok(overlay.classList.contains("opacity-0"), "visibilitychange hidden should not show overlay");

  doc.hidden = false;
  doc.dispatchDocEvent("visibilitychange");
  assert.ok(overlay.classList.contains("opacity-0"), "visibilitychange visible should not show overlay");
});

test("expanded card shows Live Demo and View Code buttons when both links are present", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const buttons = contentDiv.querySelectorAll("button");
  assert.strictEqual(buttons.length, 2, "expanded card should have two buttons");
  assert.strictEqual(buttons[0].textContent, "Live Demo", "first button should be Live Demo");
  assert.strictEqual(buttons[1].textContent, "View Code", "second button should be View Code");
  assert.ok(!buttons[0].hasAttribute("disabled"), "Live Demo should be enabled");
  assert.ok(!buttons[1].hasAttribute("disabled"), "View Code should be enabled");
});

test("missing project_link disables Live Demo and relabels", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const [live, code] = contentDiv.querySelectorAll("button");
  assert.ok(live, "Live Demo button should exist");
  assert.ok(code, "View Code button should exist");
  assert.strictEqual(live.textContent, "No project link");
  assert.strictEqual(live.getAttribute("disabled"), "", "Live Demo should be disabled");
  assert.strictEqual(code.textContent, "View Code");
  assert.ok(!code.hasAttribute("disabled"), "View Code should be enabled");
});

test("missing source_code_link disables View Code and relabels", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const [live, code] = contentDiv.querySelectorAll("button");
  assert.ok(live, "Live Demo button should exist");
  assert.ok(code, "View Code button should exist");
  assert.strictEqual(live.textContent, "Live Demo");
  assert.ok(!live.hasAttribute("disabled"), "Live Demo should be enabled");
  assert.strictEqual(code.textContent, "No source code link");
  assert.strictEqual(code.getAttribute("disabled"), "", "View Code should be disabled");
});

test("both links missing shows two disabled buttons", () => {
  const { app, grid } = setup();
  const project = { id: 1, project_name: "P" };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const [live, code] = contentDiv.querySelectorAll("button");
  assert.ok(live, "Live Demo button should exist");
  assert.ok(code, "View Code button should exist");
  assert.strictEqual(live.textContent, "No project link");
  assert.strictEqual(live.getAttribute("disabled"), "", "Live Demo should be disabled");
  assert.strictEqual(code.textContent, "No source code link");
  assert.strictEqual(code.getAttribute("disabled"), "", "View Code should be disabled");
});

test("unsafe URL schemes disable buttons", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "javascript:alert(1)",
    source_code_link: "data:text/html,<script>alert(1)</script>",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const [live, code] = contentDiv.querySelectorAll("button");
  assert.ok(live, "Live Demo button should exist");
  assert.ok(code, "View Code button should exist");
  assert.strictEqual(live.textContent, "No project link");
  assert.strictEqual(live.getAttribute("disabled"), "", "Live Demo should be disabled");
  assert.strictEqual(code.textContent, "No source code link");
  assert.strictEqual(code.getAttribute("disabled"), "", "View Code should be disabled");
});

test("clicking Live Demo opens project link and keeps card expanded", () => {
  const { app, grid, win } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const live = contentDiv.querySelectorAll("button")[0];
  live.click();
  assert.strictEqual(win._opened, "https://example.com/project", "Live Demo should open project link");
  assert.strictEqual(win._openTarget, "_blank", "Live Demo should open in a new tab");
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "card should stay expanded");
});

test("clicking View Code opens source link and keeps card expanded", () => {
  const { app, grid, win } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const code = contentDiv.querySelectorAll("button")[1];
  code.click();
  assert.strictEqual(win._opened, "https://github.com/example/repo", "View Code should open source link");
  assert.strictEqual(win._openTarget, "_blank", "View Code should open in a new tab");
  assert.strictEqual(card.getAttribute("aria-expanded"), "true", "card should stay expanded");
});

test("buttons are not rendered when card is collapsed", () => {
  const { app } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { contentDiv } = app.createProjectCard(project, {}, {});
  assert.strictEqual(contentDiv.querySelectorAll("button").length, 0, "collapsed card should have no buttons");
});

test("buttons are removed on collapse", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();
  assert.strictEqual(contentDiv.querySelectorAll("button").length, 2, "buttons should appear on expand");

  card.click();
  assert.strictEqual(contentDiv.querySelectorAll("button").length, 0, "buttons should be removed on collapse");
});

test("expanded title link remains when buttons are present", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const h3 = contentDiv.querySelector("h3");
  assert.ok(h3, "title heading should exist");
  assert.strictEqual(h3.parentNode.tagName, "A", "title should still be a link");
  assert.strictEqual(h3.parentNode.getAttribute("href"), "https://example.com/project", "title link should still point to project link");
});

test("buttons are the last children of the content div", () => {
  const { app, grid } = setup();
  const project = {
    id: 1,
    project_name: "P",
    project_link: "https://example.com/project",
    source_code_link: "https://github.com/example/repo",
  };
  const { card, contentDiv } = app.createProjectCard(project, {}, {});
  grid.appendChild(card);
  card.click();

  const buttons = contentDiv.querySelectorAll("button");
  const children = Array.from(contentDiv.children);
  assert.strictEqual(children[children.length - 2], buttons[0], "Live Demo should be second-to-last child");
  assert.strictEqual(children[children.length - 1], buttons[1], "View Code should be last child");
});
