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
