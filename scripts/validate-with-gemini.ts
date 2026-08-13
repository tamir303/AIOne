import { pathToFileURL } from "node:url";

export type Verdict = "pass" | "fail-missing-context" | "fail-needs-fix";

export interface ValidationInput {
  issueNumber: number;
  issueBody: string;
  diff: string;
  testOutput: string;
}

export interface ValidationResult {
  verdict: Verdict;
  explanation: string;
}

const VALID_VERDICTS: readonly Verdict[] = ["pass", "fail-missing-context", "fail-needs-fix"];

export function buildValidationPrompt(input: ValidationInput): string {
  return `You are validating a piece of implementation work against its ticket before it becomes a pull request.

## Ticket #${input.issueNumber}

${input.issueBody}

## Diff

\`\`\`diff
${input.diff}
\`\`\`

## Test output

\`\`\`
${input.testOutput}
\`\`\`

Judge the diff strictly against the ticket's stated scope and acceptance criteria, and against the test output. Respond with ONLY a JSON object, no markdown fences, no other text, matching exactly this shape:

{"verdict": "pass" | "fail-missing-context" | "fail-needs-fix", "explanation": "..."}

Use "fail-missing-context" only if you cannot judge the work because something about it is unexplained by the ticket or the diff — state exactly what's missing in "explanation". Use "fail-needs-fix" if you can judge it and it has a real defect — state exactly what's wrong and, if possible, what would fix it. Use "pass" only if the diff genuinely satisfies the ticket's scope and the tests support that.`;
}

export function parseVerdict(raw: string): ValidationResult {
  const stripped = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    throw new Error(`Gemini response was not valid JSON: ${raw.slice(0, 200)}`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("verdict" in parsed) ||
    !("explanation" in parsed)
  ) {
    throw new Error(`Gemini response JSON missing required fields: ${raw.slice(0, 200)}`);
  }

  const { verdict, explanation } = parsed as { verdict: unknown; explanation: unknown };

  if (typeof verdict !== "string" || !VALID_VERDICTS.includes(verdict as Verdict)) {
    throw new Error(`Gemini response had an invalid verdict value: ${String(verdict)}`);
  }
  if (typeof explanation !== "string") {
    throw new Error("Gemini response's explanation was not a string");
  }

  return { verdict: verdict as Verdict, explanation };
}

async function callGemini(prompt: string, apiKey: string, model: string): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API request failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini API response had no text content: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return text;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set in the environment.");
    process.exit(1);
    return;
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

  const raw = await readStdin();
  let input: ValidationInput;
  try {
    input = JSON.parse(raw) as ValidationInput;
  } catch {
    console.error("stdin was not valid JSON. Expected {issueNumber, issueBody, diff, testOutput}.");
    process.exit(1);
    return;
  }

  const prompt = buildValidationPrompt(input);

  let result: ValidationResult;
  try {
    const rawResponse = await callGemini(prompt, apiKey, model);
    result = parseVerdict(rawResponse);
  } catch (err) {
    result = {
      verdict: "fail-missing-context",
      explanation: `Validation tool could not produce a verdict: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  console.log(JSON.stringify(result));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
