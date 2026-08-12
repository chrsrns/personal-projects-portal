const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const INPUT_CSS = fs.readFileSync(path.resolve(__dirname, "../input.css"), "utf-8");

test("collapsed .expanded children hidden to prevent track blowout", () => {
  assert.match(
    INPUT_CSS,
    /\.cell\s+\.expanded\s*>\s*\*\s*\{\s*display:\s*none;?/,
    ".cell .expanded > * should display: none when collapsed"
  );
});

test("expanded .expanded children shown", () => {
  assert.match(
    INPUT_CSS,
    /\.cell\.expanded\s+\.expanded\s*>\s*\*\s*\{\s*display:\s*flex;?/,
    ".cell.expanded .expanded > * should display: flex when expanded"
  );
});

test("1fr tracks clamped to minmax(0, 1fr)", () => {
  assert.match(
    INPUT_CSS,
    /grid-template-rows:\s*minmax\(\s*0\s*,\s*1fr\s*\)\s+0fr/,
    "collapsed cell rows should use minmax(0, 1fr) 0fr"
  );
  assert.match(
    INPUT_CSS,
    /grid-template-rows:\s*0fr\s+minmax\(\s*0\s*,\s*1fr\s*\)/,
    "expanded cell rows should use 0fr minmax(0, 1fr)"
  );
});

test("tap-hint keyframes run for 1.5s", () => {
  assert.match(
    INPUT_CSS,
    /@keyframes\s+tap-hint\s*\{/,
    "@keyframes tap-hint should exist in input.css"
  );
  assert.match(
    INPUT_CSS,
    /animation:\s*tap-hint\s+1\.5s/i,
    "tap-hint animation should run for 1.5s"
  );
});

test("tap-hint hidden when reduced motion is requested", () => {
  assert.match(
    INPUT_CSS,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.tap-hint\s*\{\s*[^}]*display:\s*none/i,
    ".tap-hint should be hidden under prefers-reduced-motion: reduce"
  );
});

test("tap-hint overlay does not intercept pointer events", () => {
  assert.match(
    INPUT_CSS,
    /\.tap-hint\s*\{[^}]*pointer-events:\s*none/i,
    ".tap-hint should use pointer-events: none"
  );
});

test("tap-hint uses an inline SVG/CSS shape, not an external image", () => {
  assert.match(
    INPUT_CSS,
    /\.tap-hint__hand\s*\{/,
    ".tap-hint__hand styles should exist"
  );
  assert.doesNotMatch(
    INPUT_CSS,
    /\.tap-hint__hand[^{]*\{[^}]*url\s*\(/i,
    ".tap-hint__hand should not load an external image"
  );
});
