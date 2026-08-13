const { test } = require("node:test");
const { strictEqual, ok } = require("node:assert");
const { isAllowedUrl } = require("./urlUtils");

test("allows http and https URLs", () => {
  ok(isAllowedUrl("http://example.com"));
  ok(isAllowedUrl("https://example.com"));
  ok(isAllowedUrl("  https://example.com/path?x=1  "));
  ok(isAllowedUrl("HTTPS://Example.com"));
});

test("rejects non-absolute and unsafe URL schemes", () => {
  strictEqual(isAllowedUrl("/img/x.png"), null);
  strictEqual(isAllowedUrl("//other.com/"), null);
  strictEqual(isAllowedUrl("javascript:alert(1)"), null);
  strictEqual(isAllowedUrl("data:text/html,<script>alert(1)</script>"), null);
  strictEqual(isAllowedUrl("file:///etc/passwd"), null);
  strictEqual(isAllowedUrl("ftp://example.com"), null);
});

test("rejects invalid or missing input", () => {
  strictEqual(isAllowedUrl(""), null);
  strictEqual(isAllowedUrl("   "), null);
  strictEqual(isAllowedUrl(null), null);
  strictEqual(isAllowedUrl(123), null);
  strictEqual(isAllowedUrl("http://"), null);
  strictEqual(isAllowedUrl("not a url"), null);
});
