import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildValidationPrompt, parseVerdict } from "./validate-with-gemini.ts";

test("buildValidationPrompt includes the issue number, body, diff, and test output", () => {
  const prompt = buildValidationPrompt({
    issueNumber: 42,
    issueBody: "Add a widget.",
    diff: "+const widget = true;",
    testOutput: "1 passing",
  });
  assert.match(prompt, /#42/);
  assert.match(prompt, /Add a widget\./);
  assert.match(prompt, /\+const widget = true;/);
  assert.match(prompt, /1 passing/);
});

test("buildValidationPrompt instructs the model to respond with only the three allowed verdicts", () => {
  const prompt = buildValidationPrompt({
    issueNumber: 1,
    issueBody: "",
    diff: "",
    testOutput: "",
  });
  assert.match(prompt, /"pass"/);
  assert.match(prompt, /"fail-missing-context"/);
  assert.match(prompt, /"fail-needs-fix"/);
});

test("parseVerdict accepts a clean JSON response", () => {
  const result = parseVerdict('{"verdict": "pass", "explanation": "Looks correct."}');
  assert.deepEqual(result, { verdict: "pass", explanation: "Looks correct." });
});

test("parseVerdict strips markdown code fences before parsing", () => {
  const raw = '```json\n{"verdict": "fail-needs-fix", "explanation": "Off by one."}\n```';
  const result = parseVerdict(raw);
  assert.deepEqual(result, { verdict: "fail-needs-fix", explanation: "Off by one." });
});

test("parseVerdict rejects a verdict value outside the allowed set", () => {
  assert.throws(
    () => parseVerdict('{"verdict": "looks-good", "explanation": "..."}'),
    /invalid verdict/,
  );
});

test("parseVerdict rejects non-JSON output", () => {
  assert.throws(() => parseVerdict("Sure, this passes!"), /not valid JSON/);
});

test("parseVerdict rejects JSON missing the explanation field", () => {
  assert.throws(() => parseVerdict('{"verdict": "pass"}'), /missing required fields/);
});

test("CLI exits with an error when GEMINI_API_KEY is not set", () => {
  const scriptPath = fileURLToPath(new URL("./validate-with-gemini.ts", import.meta.url));
  const result = spawnSync(process.execPath, ["--import", "tsx/esm", scriptPath], {
    input: JSON.stringify({ issueNumber: 1, issueBody: "x", diff: "x", testOutput: "x" }),
    encoding: "utf8",
    env: { ...process.env, GEMINI_API_KEY: "" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /GEMINI_API_KEY is not set/);
});
