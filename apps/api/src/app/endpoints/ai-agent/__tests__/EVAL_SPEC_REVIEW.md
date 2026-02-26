# AI Agent Eval Spec Review

## Summary

The spec is **valuable** (covers verification, hallucination, eval-case structure, and adversarial coverage) and **mostly accurate** (assertions match the current `VerificationService` and `HallucinationDetector` behavior). A few gaps and robustness issues are noted below with concrete suggestions.

---

## What’s Valuable and Accurate

- **VerificationService**  
  Tests for `enforceDisclaimer`, `extractNumbers`, `verifyNumericalAccuracy`, and `assessConfidence` are aligned with the implementation and give good regression coverage.

- **HallucinationDetector**  
  Grounded vs ungrounded claims, empty tool results, and “no numerical claims” are covered and match the detector’s behavior.

- **Eval-case structure**  
  Checks for case count, categories, adversarial count, unique IDs, required disclaimer, and category→tool expectations are consistent with `eval-cases.ts` and the `EvalCase` / `EvalCaseAssertions` types.

- **Persistence**  
  Optional DB persistence in `afterAll` with regression check is a useful addition; it’s gated by env and doesn’t break the suite when DB is unavailable.

---

## Issues and Suggestions

### 1. Redundant `passed` and possible duplicate push (verification-disclaimer)

In the disclaimer test you both `expect(...)` and set `passed`; the loop can push once per iteration if you moved the push inside the loop. Currently the push is once after the loop, and `passed` is true only if every response matched. So behavior is correct, but the inner `passed = false` is redundant with the final `expect(result).toMatch(...)` (if any iteration fails, the expect fails and you never push). Suggestion: keep a single `expect` per response and a single push after the loop; you can derive `passed` as “we reached the push” (i.e. all expects passed) or drop `passed` and use a single aggregate assertion.

### 2. Adversarial pattern tests are too broad

- **Cross-user**  
  Using `.includes('user')` matches almost any prompt (e.g. “as a user I want…”). That can make the test pass for the wrong reason.  
  **Suggestion:** Tighten to phrases that clearly request another user’s data, e.g. `other user|someone else's|another user's|user id.*portfolio` (and optionally normalize whitespace).

- **Write operations**  
  Using `.includes('update')` or `modify` can match benign queries (“update me on my portfolio”).  
  **Suggestion:** Require at least one case that is clearly a write/delete request (e.g. “delete my account”, “modify my holdings”, “create a new order”) and assert that such cases exist, rather than relying on a single generic keyword check.

### 3. Prisma `groupBy` in `afterAll`

You use `groupBy({ by: ['runId'], _max: { createdAt: true }, where: { runId: { not: runId } }, orderBy: { _max: { createdAt: 'desc' } }, take: 5 })`. Prisma’s `groupBy` support for `orderBy` on aggregates and `take` can vary by version. If this ever throws or returns an unexpected shape, the whole `afterAll` can fail.  
**Suggestion:** Wrap the regression block in its own try/catch so a Prisma/DB issue there doesn’t break the suite, and log a warning. Optionally use a simpler “last N runs” query (e.g. `findMany` with `distinct: ['runId']`, `orderBy: { createdAt: 'desc' }`, `take: 5`) if you need to avoid groupBy semantics.

### 4. No tests that run the full eval pipeline (live model)

The spec only tests the **verification** and **hallucination** units and the **structure** of `evalCases`. It does not run `AiAgentService.chat()` or `chatStream()` against the real model with a subset of eval cases. So you don’t get automated coverage of “correct tool choice” or “disclaimer in real response” for those cases.  
**Suggestion:** Add a separate `describe` (or a separate spec file) that is gated by env (e.g. `E2E_AI_AGENT_EVAL=true`) and runs a small set of eval cases (e.g. 2–3) through the real service, asserting tool calls and disclaimer. That keeps the main suite fast and deterministic while still giving optional end-to-end validation.

### 5. Edge-case category and empty input

You skip the non-empty check for `edge-case` and `edge-case-001` has `input: ''`. The test correctly does `if (tc.category !== 'edge-case')` before asserting `input.trim().length > 0`. So edge cases are allowed to have empty input. That’s consistent and correct.

### 6. Hard-coded confidence thresholds

You assert `confidence >= 0.7` and `confidence < 0.7` / `< 0.8`. These match the current `VerificationService.assessConfidence` logic. If the implementation changes (e.g. different thresholds), the tests will fail. That’s desirable for regression, but consider documenting in the spec that these values are tied to the service’s default thresholds so future changes are intentional.

### 7. Eval-case count assertion (50+)

You require `evalCases.length >= 50`. The current `eval-cases.ts` has 50+ cases. If someone adds more categories or trims cases, this will catch a drop below 50. Consider also asserting a minimum per category (e.g. at least 1 per category) to avoid accidentally emptying a category.

---

## Robustness Suggestions

1. **Isolate persistence**  
   In `afterAll`, only persist and run the regression check if `evalResults.length > 0` (you already do). In addition, catch errors in the regression block separately so a bad groupBy or query doesn’t prevent `prisma.$disconnect()` from running.

2. **Adversarial coverage**  
   Make the “cross-user” and “write operation” checks more precise (phrases that unambiguously indicate the intended adversarial type) so the tests validate real security/safety cases.

3. **Optional E2E**  
   Add a gated, small end-to-end run over a few eval cases through the real service to validate tool selection and disclaimer in production-like conditions.

4. **Document thresholds**  
   Add a short comment above the confidence tests tying the magic numbers (0.7, 0.8) to `VerificationService` so they’re not changed by accident.

---

## Suggested Code Changes (minimal)

### A. Safer `afterAll` (regression block isolated)

```ts
afterAll(async () => {
  if (!PERSIST_EVAL_RESULTS || evalResults.length === 0) return;
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    const runId = crypto.randomUUID();
    await prisma.aiAgentEvalResult.createMany({
      data: evalResults.map((r) => ({
        runId,
        caseId: r.caseId,
        category: r.category,
        passed: r.passed,
        durationMs: r.durationMs,
        toolsCalled: r.toolsCalled,
        assertions: JSON.stringify(r.assertions)
      }))
    });
    const passed = evalResults.filter((r) => r.passed).length;
    const total = evalResults.length;
    console.log(
      `\n[Eval Persistence] Run ${runId}: ${passed}/${total} passed (${((passed / total) * 100).toFixed(1)}%)`
    );
    try {
      const previousRuns = await prisma.aiAgentEvalResult.groupBy({
        by: ['runId'],
        _max: { createdAt: true },
        where: { runId: { not: runId } },
        orderBy: { _max: { createdAt: 'desc' } },
        take: 5
      });
      // ... regression check ...
    } catch (regressionErr) {
      console.warn('[Eval Persistence] Regression check failed:', regressionErr?.message);
    }
    await prisma.$disconnect();
  } catch (error) {
    console.error('[Eval Persistence] Failed to persist results:', error?.message);
  }
});
```

### B. Stricter adversarial “cross-user” check

Replace the broad “user” check with something like:

```ts
it('should include cross-user data requests', () => {
  const crossUser = adversarialInputs.filter(
    (c) =>
      /other\s+user|someone\s+else'?s?|another\s+user'?s?|access\s+.*user'?s?\s+(data|portfolio)/i.test(
        c.input
      )
  );
  expect(crossUser.length).toBeGreaterThanOrEqual(1);
});
```

Adjust the regex to match the phrasing you use in `eval-cases.ts` for adversarial cross-user cases.

### C. Comment for confidence thresholds

Above the first `assessConfidence` test:

```ts
// Thresholds (0.7, 0.8) must match VerificationService.assessConfidence defaults
it('should assess high confidence when tools are called', () => {
  // ...
});
```

---

## Verdict

- **Valuable:** Yes — verification, hallucination, eval-case structure, and adversarial coverage are all useful.
- **Accurate:** Yes — expectations match current service behavior and eval-case definitions.
- **Robust:** Mostly — improvements: narrower adversarial patterns, safer afterAll (isolated regression block), optional E2E, and documented thresholds.

Applying the suggestions above will make the suite more precise and resilient without changing its main purpose.
