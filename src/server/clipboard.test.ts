import assert from "node:assert/strict";
import test from "node:test";
import { copyWithFallback } from "../clipboard.js";

test("permission-denied Clipboard API falls back to DOM copy", async () => {
  let legacyCalls = 0;
  const copied = await copyWithFallback("保存结果", async () => {
    throw new DOMException("Write permission denied.", "NotAllowedError");
  }, () => { legacyCalls++; return true; });
  assert.equal(copied, true);
  assert.equal(legacyCalls, 1);
});

test("blocked copy reports manual-copy outcome and never claims success", async () => {
  assert.equal(await copyWithFallback("内容", async () => { throw new Error("denied"); }, () => false), false);
  assert.equal(await copyWithFallback("内容", undefined, () => { throw new Error("blocked"); }), false);
});

test("successful native copy avoids the legacy path", async () => {
  let content = "";
  assert.equal(await copyWithFallback("内容", async (value) => { content = value; }, () => { throw new Error("should not run"); }), true);
  assert.equal(content, "内容");
});
