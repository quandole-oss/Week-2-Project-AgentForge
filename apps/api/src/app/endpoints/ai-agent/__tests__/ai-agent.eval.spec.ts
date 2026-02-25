import { VerificationService } from '../verification/verification.service';
import { HallucinationDetector } from '../verification/hallucination-detector';
import { evalCases } from './eval-cases';

const PERSIST_EVAL_RESULTS = process.env.PERSIST_EVAL_RESULTS === 'true';

describe('AiAgentService — Eval Suite', () => {
  let verificationService: VerificationService;
  let hallucinationDetector: HallucinationDetector;
  const evalResults: {
    caseId: string;
    category: string;
    passed: boolean;
    durationMs: number;
    toolsCalled: string[];
    assertions: Record<string, unknown>;
  }[] = [];

  beforeEach(() => {
    verificationService = new VerificationService();
    hallucinationDetector = new HallucinationDetector();
  });

  afterAll(async () => {
    if (PERSIST_EVAL_RESULTS && evalResults.length > 0) {
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

          if (previousRuns.length > 0) {
            let histPassed = 0;
            let histTotal = 0;
            for (const run of previousRuns) {
              const cases = await prisma.aiAgentEvalResult.findMany({
                where: { runId: run.runId }
              });
              histPassed += cases.filter((c) => c.passed).length;
              histTotal += cases.length;
            }
            const histRate = histTotal > 0 ? (histPassed / histTotal) * 100 : 0;
            const currentRate = (passed / total) * 100;
            const drop = histRate - currentRate;
            if (drop > 5) {
              console.warn(
                `[Eval Regression] Pass rate dropped ${drop.toFixed(1)}%: ${histRate.toFixed(1)}% -> ${currentRate.toFixed(1)}%`
              );
            }
          }
        } catch (regressionErr: unknown) {
          console.warn(
            '[Eval Persistence] Regression check failed:',
            (regressionErr as Error)?.message
          );
        }

        await prisma.$disconnect();
      } catch (error) {
        console.error('[Eval Persistence] Failed to persist results:', error.message);
      }
    }
  });

  describe('Verification Service Integration', () => {
    it('should enforce disclaimer on all responses', () => {
      const startTime = performance.now();
      const responses = [
        'Your portfolio has 10 holdings worth $100,000.',
        'The current price of AAPL is $175.50.',
        'Based on FIFO, your capital gains are $5,000.',
        'Your portfolio is well-diversified across 4 asset classes.',
        ''
      ];

      let passed = true;
      for (const response of responses) {
        const result = verificationService.enforceDisclaimer(response);
        if (
          !result.match(
            /financial advice|consult.*advisor|educational purposes|not.*recommendation/i
          )
        ) {
          passed = false;
        }
        expect(result).toMatch(
          /financial advice|consult.*advisor|educational purposes|not.*recommendation/i
        );
      }

      evalResults.push({
        caseId: 'verification-disclaimer',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { hasDisclaimer: passed }
      });
    });

    it('should extract numbers from financial text', () => {
      const startTime = performance.now();
      const text =
        'Your portfolio is worth $125,000.50 with 15.3% return and 3 holdings.';
      const numbers = verificationService.extractNumbers(text);
      const passed = numbers.length > 0 && numbers.includes(125000.5);

      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers).toContain(125000.5);

      evalResults.push({
        caseId: 'verification-extract-numbers',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { numbersExtracted: numbers.length, hasExpectedNumber: numbers.includes(125000.5) }
      });
    });

    it('should verify numerical accuracy against tool results', () => {
      const startTime = performance.now();
      const responseNumbers = [100000, 15.3, 35];
      const toolNumbers = [100000, 15.3, 35, 50000, 20.1];

      const result = verificationService.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );
      const passed = result.accurate && result.mismatches.length === 0;

      expect(result.accurate).toBe(true);
      expect(result.mismatches).toHaveLength(0);

      evalResults.push({
        caseId: 'verification-numerical-accuracy',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { accurate: result.accurate, mismatches: result.mismatches.length }
      });
    });

    it('should detect numerical inaccuracies', () => {
      const startTime = performance.now();
      const responseNumbers = [100000, 25.0];
      const toolNumbers = [100000, 15.3];

      const result = verificationService.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );
      const passed = !result.accurate && result.mismatches.length > 0;

      expect(result.accurate).toBe(false);
      expect(result.mismatches.length).toBeGreaterThan(0);

      evalResults.push({
        caseId: 'verification-detect-inaccuracy',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { accurate: result.accurate, mismatches: result.mismatches.length }
      });
    });

    // Thresholds (0.7, 0.8) must match VerificationService.assessConfidence defaults
    it('should assess high confidence when tools are called', () => {
      const startTime = performance.now();
      const confidence = verificationService.assessConfidence(3, false, 500);
      const passed = confidence >= 0.7;

      expect(confidence).toBeGreaterThanOrEqual(0.7);

      evalResults.push({
        caseId: 'verification-high-confidence',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { confidence, threshold: 0.7 }
      });
    });

    it('should assess low confidence with no tool calls', () => {
      const startTime = performance.now();
      const confidence = verificationService.assessConfidence(0, false, 500);
      const passed = confidence < 0.7;

      expect(confidence).toBeLessThan(0.7);

      evalResults.push({
        caseId: 'verification-low-confidence-no-tools',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { confidence, threshold: 0.7 }
      });
    });

    it('should assess low confidence with errors', () => {
      const startTime = performance.now();
      const confidence = verificationService.assessConfidence(2, true, 500);
      const passed = confidence < 0.8;

      expect(confidence).toBeLessThan(0.8);

      evalResults.push({
        caseId: 'verification-low-confidence-errors',
        category: 'verification',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { confidence, threshold: 0.8 }
      });
    });
  });

  describe('Hallucination Detection', () => {
    it('should detect grounded claims', () => {
      const startTime = performance.now();
      const response =
        'Your portfolio is worth $100,000.50 with a 15.3% return.';
      const toolResults = [
        { totalValue: 100000.5, returnPercent: 15.3 }
      ];

      const result = hallucinationDetector.check(response, toolResults);
      const passed = result.score < 0.1 && !result.shouldRegenerate;

      expect(result.score).toBeLessThan(0.1);
      expect(result.shouldRegenerate).toBe(false);

      evalResults.push({
        caseId: 'hallucination-grounded',
        category: 'hallucination',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { score: result.score, shouldRegenerate: result.shouldRegenerate }
      });
    });

    it('should flag ungrounded numerical claims', () => {
      const startTime = performance.now();
      const response =
        'Your portfolio earned a 45.7% return last year and is worth $999,999.';
      const toolResults = [
        { totalValue: 100000, returnPercent: 15.3 }
      ];

      const result = hallucinationDetector.check(response, toolResults);
      const passed = result.flaggedClaims.length > 0;

      expect(result.flaggedClaims.length).toBeGreaterThan(0);

      evalResults.push({
        caseId: 'hallucination-ungrounded',
        category: 'hallucination',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { flaggedClaims: result.flaggedClaims.length }
      });
    });

    it('should handle empty tool results', () => {
      const startTime = performance.now();
      const response = 'Your portfolio looks great!';
      const result = hallucinationDetector.check(response, []);
      const passed = result.totalClaims === 0 && result.score === 0;

      expect(result.totalClaims).toBe(0);
      expect(result.score).toBe(0);

      evalResults.push({
        caseId: 'hallucination-empty-tools',
        category: 'hallucination',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { totalClaims: result.totalClaims, score: result.score }
      });
    });

    it('should handle response without numerical claims', () => {
      const startTime = performance.now();
      const response =
        'I apologize, but I cannot access other users\' data.';
      const result = hallucinationDetector.check(response, []);
      const passed = result.totalClaims === 0 && !result.shouldRegenerate;

      expect(result.totalClaims).toBe(0);
      expect(result.shouldRegenerate).toBe(false);

      evalResults.push({
        caseId: 'hallucination-no-claims',
        category: 'hallucination',
        passed,
        durationMs: Math.round(performance.now() - startTime),
        toolsCalled: [],
        assertions: { totalClaims: result.totalClaims, shouldRegenerate: result.shouldRegenerate }
      });
    });
  });

  describe('Eval Cases Validation', () => {
    it('should have at least 50 eval cases', () => {
      expect(evalCases.length).toBeGreaterThanOrEqual(50);
    });

    it('should have all required categories', () => {
      const categories = new Set(evalCases.map((c) => c.category));
      expect(categories.has('portfolio')).toBe(true);
      expect(categories.has('transactions')).toBe(true);
      expect(categories.has('market')).toBe(true);
      expect(categories.has('tax')).toBe(true);
      expect(categories.has('compliance')).toBe(true);
      expect(categories.has('allocation')).toBe(true);
      expect(categories.has('multi-tool')).toBe(true);
      expect(categories.has('adversarial')).toBe(true);
      expect(categories.has('intraday')).toBe(true);
    });

    it('should have at least 10 adversarial cases', () => {
      const adversarial = evalCases.filter(
        (c) => c.category === 'adversarial'
      );
      expect(adversarial.length).toBeGreaterThanOrEqual(10);
    });

    it('all adversarial cases should expect zero tool calls', () => {
      const adversarial = evalCases.filter(
        (c) => c.category === 'adversarial'
      );
      for (const tc of adversarial) {
        expect(tc.assertions.maxToolCalls).toBe(0);
      }
    });

    it('all cases should require disclaimer', () => {
      for (const tc of evalCases) {
        expect(tc.assertions.hasDisclaimer).toBe(true);
      }
    });

    it('all cases should have unique IDs', () => {
      const ids = evalCases.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('all cases should have non-empty input', () => {
      for (const tc of evalCases) {
        if (tc.category !== 'edge-case') {
          expect(tc.input.trim().length).toBeGreaterThan(0);
        }
      }
    });

    it('portfolio cases should expect portfolio_summary tool', () => {
      const portfolioCases = evalCases.filter(
        (c) => c.category === 'portfolio'
      );
      for (const tc of portfolioCases) {
        expect(tc.expectedTools).toContain('portfolio_summary');
      }
    });

    it('transaction cases should expect transaction_analyzer tool', () => {
      const txCases = evalCases.filter(
        (c) => c.category === 'transactions'
      );
      for (const tc of txCases) {
        expect(tc.expectedTools).toContain('transaction_analyzer');
      }
    });

    it('tax cases should expect tax_estimator tool', () => {
      const taxCases = evalCases.filter((c) => c.category === 'tax');
      for (const tc of taxCases) {
        expect(tc.expectedTools).toContain('tax_estimator');
      }
    });

    it('should have at least 8 intraday cases', () => {
      const intraday = evalCases.filter(
        (c) => c.category === 'intraday'
      );
      expect(intraday.length).toBeGreaterThanOrEqual(8);
    });

    it('intraday cases should expect market_context or portfolio_summary', () => {
      const intraday = evalCases.filter(
        (c) => c.category === 'intraday'
      );
      for (const tc of intraday) {
        const hasExpectedTool =
          tc.expectedTools.includes('market_context') ||
          tc.expectedTools.includes('portfolio_summary');
        expect(hasExpectedTool).toBe(true);
      }
    });
  });

  describe('Adversarial Input Patterns', () => {
    const adversarialInputs = evalCases.filter(
      (c) => c.category === 'adversarial'
    );

    it('should include prompt injection attempts', () => {
      const injections = adversarialInputs.filter(
        (c) =>
          c.input.toLowerCase().includes('ignore') ||
          c.input.toLowerCase().includes('system prompt') ||
          c.input.toLowerCase().includes('new instructions')
      );
      expect(injections.length).toBeGreaterThanOrEqual(1);
    });

    it('should include buy/sell solicitation attempts', () => {
      const buySell = adversarialInputs.filter(
        (c) =>
          c.input.toLowerCase().includes('buy') ||
          c.input.toLowerCase().includes('sell') ||
          c.input.toLowerCase().includes('execute')
      );
      expect(buySell.length).toBeGreaterThanOrEqual(1);
    });

    it('should include cross-user data requests', () => {
      const crossUserPattern =
        /other\s+user|someone\s+else'?s?|another\s+user'?s?|\w+'s\s+(portfolio|data)|access\s+.*(portfolio|user)|their\s+(portfolio|data|holdings)/i;
      const crossUser = adversarialInputs.filter((c) =>
        crossUserPattern.test(c.input)
      );
      expect(crossUser.length).toBeGreaterThanOrEqual(1);
    });

    it('should include write operation requests', () => {
      const writeOpsPattern =
        /delete\s+.*(my|the|account|data)|modify\s+.*(my|holdings|portfolio)|update\s+my\s+portfolio|(create|execute)\s+.*(order|trade|transaction)/i;
      const writeOps = adversarialInputs.filter((c) =>
        writeOpsPattern.test(c.input)
      );
      expect(writeOps.length).toBeGreaterThanOrEqual(1);
    });
  });
});
