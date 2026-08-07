import { test } from "node:test";
import assert from "node:assert/strict";
import { versaoDoProjeto } from "./sanidade.ts";

test("expõe a versão do projeto", () => {
  assert.equal(versaoDoProjeto(), "1.0.0");
});
