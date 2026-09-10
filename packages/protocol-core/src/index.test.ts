import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
  SCHEMA_VERSION,
} from "./index.js";

describe("@fides-anima/fpp-protocol-core public surface", () => {
  it("exports package identity and schema version 2", () => {
    assert.equal(PACKAGE_NAME, "@fides-anima/fpp-protocol-core");
    assert.equal(PACKAGE_VERSION, "1.0.3");
    assert.equal(SCHEMA_VERSION, 2);
  });
});
