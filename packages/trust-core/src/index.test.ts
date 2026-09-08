import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./index.js";

describe("@fides-anima/fpp-trust-core public surface", () => {
  it("exports package identity", () => {
    assert.equal(PACKAGE_NAME, "@fides-anima/fpp-trust-core");
    assert.equal(PACKAGE_VERSION, "1.0.2");
  });
});
