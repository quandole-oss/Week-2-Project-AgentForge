import { VerificationService } from '../verification/verification.service';
import { HallucinationDetector } from '../verification/hallucination-detector';
import { evalCases } from './eval-cases';

describe('AiAgentService — Eval Suite', () => {
  let verificationService: VerificationService;
  let hallucinationDetector: HallucinationDetector;

  beforeEach(() => {
    verificationService = new VerificationService();
    hallucinationDetector = new HallucinationDetector();
  });

  describe('Verification Service Integration', () => {
    it('should enforce disclaimer on all responses', () => {
      const responses = [
        'Your portfolio has 10 holdings worth $100,000.',
        'The current price of AAPL is $175.50.',
        'Based on FIFO, your capital gains are $5,000.',
        'Your portfolio is well-diversified across 4 asset classes.',
        ''
      ];

      for (const response of responses) {
        const result = verificationService.enforceDisclaimer(response);
        expect(result).toMatch(
          /financial advice|consult.*advisor|educational purposes|not.*recommendation/i
        );
      }
    });

    it('should extract numbers from financial text', () => {
      const text =
        'Your portfolio is worth $125,000.50 with 15.3% return and 3 holdings.';
      const numbers = verificationService.extractNumbers(text);
      expect(numbers.length).toBeGreaterThan(0);
      expect(numbers).toContain(125000.5);
    });

    it('should verify numerical accuracy against tool results', () => {
      const responseNumbers = [100000, 15.3, 35];
      const toolNumbers = [100000, 15.3, 35, 50000, 20.1];

      const result = verificationService.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );
      expect(result.accurate).toBe(true);
      expect(result.mismatches).toHaveLength(0);
    });

    it('should detect numerical inaccuracies', () => {
      const responseNumbers = [100000, 25.0];
      const toolNumbers = [100000, 15.3];

      const result = verificationService.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );
      expect(result.accurate).toBe(false);
      expect(result.mismatches.length).toBeGreaterThan(0);
    });

    it('should assess high confidence when tools are called', () => {
      const confidence = verificationService.assessConfidence(3, false, 500);
      expect(confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should assess low confidence with no tool calls', () => {
      const confidence = verificationService.assessConfidence(0, false, 500);
      expect(confidence).toBeLessThan(0.7);
    });

    it('should assess low confidence with errors', () => {
      const confidence = verificationService.assessConfidence(2, true, 500);
      expect(confidence).toBeLessThan(0.8);
    });
  });

  describe('Hallucination Detection', () => {
    it('should detect grounded claims', () => {
      const response =
        'Your portfolio is worth $100,000.50 with a 15.3% return.';
      const toolResults = [
        { totalValue: 100000.5, returnPercent: 15.3 }
      ];

      const result = hallucinationDetector.check(response, toolResults);
      expect(result.score).toBeLessThan(0.1);
      expect(result.shouldRegenerate).toBe(false);
    });

    it('should flag ungrounded numerical claims', () => {
      const response =
        'Your portfolio earned a 45.7% return last year and is worth $999,999.';
      const toolResults = [
        { totalValue: 100000, returnPercent: 15.3 }
      ];

      const result = hallucinationDetector.check(response, toolResults);
      expect(result.flaggedClaims.length).toBeGreaterThan(0);
    });

    it('should handle empty tool results', () => {
      const response = 'Your portfolio looks great!';
      const result = hallucinationDetector.check(response, []);
      expect(result.totalClaims).toBe(0);
      expect(result.score).toBe(0);
    });

    it('should handle response without numerical claims', () => {
      const response =
        'I apologize, but I cannot access other users\' data.';
      const result = hallucinationDetector.check(response, []);
      expect(result.totalClaims).toBe(0);
      expect(result.shouldRegenerate).toBe(false);
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
      const crossUser = adversarialInputs.filter(
        (c) =>
          c.input.toLowerCase().includes('other user') ||
          c.input.toLowerCase().includes('user') ||
          c.input.toLowerCase().includes('someone else')
      );
      expect(crossUser.length).toBeGreaterThanOrEqual(1);
    });

    it('should include write operation requests', () => {
      const writeOps = adversarialInputs.filter(
        (c) =>
          c.input.toLowerCase().includes('delete') ||
          c.input.toLowerCase().includes('modify') ||
          c.input.toLowerCase().includes('update') ||
          c.input.toLowerCase().includes('create')
      );
      expect(writeOps.length).toBeGreaterThanOrEqual(1);
    });
  });
});
