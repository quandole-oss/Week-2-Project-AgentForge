import { VerificationService } from '../../verification/verification.service';

describe('VerificationService', () => {
  let service: VerificationService;

  beforeEach(() => {
    service = new VerificationService();
  });

  // ---------------------------------------------------------------------------
  // enforceDisclaimer
  // ---------------------------------------------------------------------------
  describe('enforceDisclaimer', () => {
    it('should append a disclaimer when the response has none', () => {
      const response =
        'Your portfolio is up 15% this year with strong performance in tech stocks.';
      const result = service.enforceDisclaimer(response);

      expect(result).toContain(response);
      expect(result).toContain('educational purposes');
      expect(result).toContain('financial advisor');
      expect(result).toContain('---');
    });

    it('should not duplicate the disclaimer when one is already present', () => {
      const response =
        'Your portfolio looks great. Please consult a qualified financial advisor before making decisions.';
      const result = service.enforceDisclaimer(response);

      // Should return as-is since the pattern matches
      expect(result).toBe(response);
    });

    it('should detect "financial advice" as an existing disclaimer', () => {
      const response =
        'This is not financial advice. Here is your portfolio breakdown.';
      const result = service.enforceDisclaimer(response);

      expect(result).toBe(response);
    });

    it('should detect "not a recommendation" as an existing disclaimer', () => {
      const response =
        'This analysis is not a recommendation to buy or sell.';
      const result = service.enforceDisclaimer(response);

      expect(result).toBe(response);
    });

    it('should detect "educational purposes" as an existing disclaimer', () => {
      const response =
        'For educational purposes only: your portfolio is diversified.';
      const result = service.enforceDisclaimer(response);

      expect(result).toBe(response);
    });
  });

  // ---------------------------------------------------------------------------
  // extractNumbers
  // ---------------------------------------------------------------------------
  describe('extractNumbers', () => {
    it('should extract integers from text', () => {
      const text = 'You have 42 holdings and 7 accounts.';
      const numbers = service.extractNumbers(text);

      expect(numbers).toContain(42);
      expect(numbers).toContain(7);
    });

    it('should extract decimal numbers', () => {
      const text = 'Performance is 15.7% with a fee ratio of 0.25%.';
      const numbers = service.extractNumbers(text);

      expect(numbers).toContain(15.7);
      expect(numbers).toContain(0.25);
    });

    it('should extract numbers with comma thousands separators', () => {
      const text = 'Your portfolio is worth $1,250,000.50 today.';
      const numbers = service.extractNumbers(text);

      expect(numbers).toContain(1250000.50);
    });

    it('should extract negative numbers', () => {
      const text = 'Net performance is -3.2% this quarter.';
      const numbers = service.extractNumbers(text);

      expect(numbers).toContain(-3.2);
    });

    it('should return an empty array when no numbers are found', () => {
      const text = 'Your portfolio looks well-diversified across sectors.';
      const numbers = service.extractNumbers(text);

      expect(numbers).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // verifyNumericalAccuracy
  // ---------------------------------------------------------------------------
  describe('verifyNumericalAccuracy', () => {
    it('should report accurate when response numbers match tool numbers', () => {
      const responseNumbers = [100, 250, 15.5];
      const toolNumbers = [100, 250, 15.5];

      const result = service.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );

      expect(result.accurate).toBe(true);
      expect(result.mismatches).toEqual([]);
    });

    it('should report accurate for numbers within tolerance', () => {
      const responseNumbers = [100.005];
      const toolNumbers = [100];

      const result = service.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers,
        0.01
      );

      expect(result.accurate).toBe(true);
    });

    it('should detect mismatches when numbers differ beyond tolerance', () => {
      const responseNumbers = [500];
      const toolNumbers = [100, 200, 300];

      const result = service.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );

      expect(result.accurate).toBe(false);
      expect(result.mismatches.length).toBe(1);
      expect(result.mismatches[0].response).toBe(500);
      expect(result.mismatches[0].closest).toBe(300);
    });

    it('should skip zero and near-zero values in response', () => {
      const responseNumbers = [0, 0.0005, 100];
      const toolNumbers = [100];

      const result = service.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers
      );

      expect(result.accurate).toBe(true);
      expect(result.mismatches).toEqual([]);
    });

    it('should respect custom tolerance', () => {
      const responseNumbers = [110];
      const toolNumbers = [100];

      // 10% drift - should fail at 1% tolerance
      const strictResult = service.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers,
        0.01
      );
      expect(strictResult.accurate).toBe(false);

      // 10% drift - should pass at 15% tolerance
      const lenientResult = service.verifyNumericalAccuracy(
        responseNumbers,
        toolNumbers,
        0.15
      );
      expect(lenientResult.accurate).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // assessConfidence
  // ---------------------------------------------------------------------------
  describe('assessConfidence', () => {
    it('should return base confidence of 0.95 for normal conditions', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 200
      });
      expect(confidence).toBe(0.95);
    });

    it('should reduce confidence by 0.35 when toolCallCount is 0', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 0,
        hasErrors: false,
        responseLength: 200
      });
      expect(confidence).toBeCloseTo(0.6, 10);
    });

    it('should reduce confidence by 0.15 when hasErrors is true', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: true,
        responseLength: 200
      });
      expect(confidence).toBeCloseTo(0.8, 10);
    });

    it('should reduce confidence by 0.1 when response is short', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 30
      });
      expect(confidence).toBeCloseTo(0.85, 10);
    });

    it('should reduce confidence proportionally to hallucination score', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 200,
        hallucinationScore: 0.1
      });
      // 0.95 - (0.1 * 0.8) = 0.95 - 0.08 = 0.87
      expect(confidence).toBeCloseTo(0.87, 10);
    });

    it('should cap hallucination penalty at 0.15', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 200,
        hallucinationScore: 0.5
      });
      // 0.95 - min(0.15, 0.5 * 0.8) = 0.95 - 0.15 = 0.80
      expect(confidence).toBeCloseTo(0.80, 10);
    });

    it('should reduce confidence by 0.1 per tool error', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 3,
        hasErrors: false,
        responseLength: 200,
        toolErrors: 2
      });
      // 0.95 - (2 * 0.1) = 0.75
      expect(confidence).toBeCloseTo(0.75, 10);
    });

    it('should apply stale data penalty after 30 minutes', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 200,
        dataAgeMinutes: 60
      });
      // 0.95 - min(0.15, (60 - 30) * 0.001) = 0.95 - 0.03 = 0.92
      expect(confidence).toBeCloseTo(0.92, 10);
    });

    it('should cap stale data penalty at 0.15', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 200,
        dataAgeMinutes: 500
      });
      // 0.95 - min(0.15, (500 - 30) * 0.001) = 0.95 - 0.15 = 0.80
      expect(confidence).toBeCloseTo(0.80, 10);
    });

    it('should not apply stale data penalty under 30 minutes', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 1,
        hasErrors: false,
        responseLength: 200,
        dataAgeMinutes: 15
      });
      expect(confidence).toBe(0.95);
    });

    it('should stack all penalties', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 0,
        hasErrors: true,
        responseLength: 10,
        hallucinationScore: 0.2,
        toolErrors: 1,
        dataAgeMinutes: 100
      });
      // 0.95 - 0.35 - 0.15 - 0.1 - min(0.15, 0.16) - 0.1 - 0.07 = 0.03
      expect(confidence).toBeCloseTo(0.03, 1);
    });

    it('should never go below 0', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 0,
        hasErrors: true,
        responseLength: 10,
        hallucinationScore: 1.0,
        toolErrors: 5,
        dataAgeMinutes: 1000
      });
      expect(confidence).toBe(0);
    });

    it('should never exceed 1', () => {
      const confidence = service.assessConfidence({
        toolCallCount: 100,
        hasErrors: false,
        responseLength: 10000
      });
      expect(confidence).toBeLessThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // getContextualDisclaimers
  // ---------------------------------------------------------------------------
  describe('getContextualDisclaimers', () => {
    it('should return empty array for empty tool list', () => {
      const disclaimers = service.getContextualDisclaimers([]);
      expect(disclaimers).toEqual([]);
    });

    it('should return matching disclaimer for a single tool', () => {
      const disclaimers = service.getContextualDisclaimers([
        'tax_estimator'
      ]);
      expect(disclaimers).toHaveLength(1);
      expect(disclaimers[0]).toContain('FIFO lot matching');
    });

    it('should return multiple disclaimers for multiple tools', () => {
      const disclaimers = service.getContextualDisclaimers([
        'tax_estimator',
        'market_context'
      ]);
      expect(disclaimers).toHaveLength(2);
      expect(disclaimers[0]).toContain('FIFO lot matching');
      expect(disclaimers[1]).toContain('delayed up to 15 minutes');
    });

    it('should deduplicate tool names', () => {
      const disclaimers = service.getContextualDisclaimers([
        'portfolio_summary',
        'portfolio_summary'
      ]);
      expect(disclaimers).toHaveLength(1);
    });

    it('should ignore unknown tool names', () => {
      const disclaimers = service.getContextualDisclaimers([
        'unknown_tool',
        'portfolio_summary'
      ]);
      expect(disclaimers).toHaveLength(1);
      expect(disclaimers[0]).toContain('data provider accuracy');
    });

    it('should return all 6 disclaimers for all tools', () => {
      const disclaimers = service.getContextualDisclaimers([
        'tax_estimator',
        'compliance_checker',
        'market_context',
        'allocation_optimizer',
        'portfolio_summary',
        'transaction_analyzer'
      ]);
      expect(disclaimers).toHaveLength(6);
    });
  });

  // ---------------------------------------------------------------------------
  // getDisclaimer
  // ---------------------------------------------------------------------------
  describe('getDisclaimer', () => {
    it('should return a non-empty string', () => {
      const disclaimer = service.getDisclaimer();
      expect(typeof disclaimer).toBe('string');
      expect(disclaimer.length).toBeGreaterThan(0);
    });

    it('should mention educational purposes and financial advisor', () => {
      const disclaimer = service.getDisclaimer();
      expect(disclaimer).toContain('educational purposes');
      expect(disclaimer).toContain('financial advisor');
    });
  });

  // ---------------------------------------------------------------------------
  // validateSourceAttribution
  // ---------------------------------------------------------------------------
  describe('validateSourceAttribution', () => {
    it('should return valid when all tool names are referenced', () => {
      const response =
        'Based on the portfolio summary and transaction analyzer data...';
      const result = service.validateSourceAttribution(response, [
        'portfolio_summary',
        'transaction_analyzer'
      ]);

      expect(result.valid).toBe(true);
      expect(result.missingAttribution).toEqual([]);
    });

    it('should detect missing attribution for unreferenced tools', () => {
      const response = 'Your portfolio looks good.';
      const result = service.validateSourceAttribution(response, [
        'portfolio_summary',
        'compliance_checker'
      ]);

      expect(result.valid).toBe(false);
      expect(result.missingAttribution).toContain('portfolio_summary');
      expect(result.missingAttribution).toContain('compliance_checker');
    });
  });
});
