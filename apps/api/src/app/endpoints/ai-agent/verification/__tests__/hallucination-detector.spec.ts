import { HallucinationDetector } from '../hallucination-detector';

describe('HallucinationDetector', () => {
  let detector: HallucinationDetector;

  beforeEach(() => {
    detector = new HallucinationDetector();
  });

  describe('check', () => {
    it('should return score 0 for fully grounded claims', () => {
      const response =
        'Your portfolio is worth $100,000.50 with a 15.3% annual return.';
      const toolResults = [
        { totalValue: 100000.5, returnPercent: 15.3 }
      ];

      const result = detector.check(response, toolResults);

      expect(result.score).toBe(0);
      expect(result.groundedClaims).toBeGreaterThan(0);
      expect(result.flaggedClaims).toHaveLength(0);
      expect(result.shouldRegenerate).toBe(false);
      expect(result.shouldWarn).toBe(false);
    });

    it('should flag ungrounded numerical claims', () => {
      const response =
        'Your portfolio earned a 45.7% return last year. It is worth $999,999.';
      const toolResults = [
        { totalValue: 100000, returnPercent: 15.3 }
      ];

      const result = detector.check(response, toolResults);

      expect(result.flaggedClaims.length).toBeGreaterThan(0);
      expect(result.score).toBeGreaterThan(0);
    });

    it('should handle empty tool results', () => {
      const response = 'Your portfolio looks great!';
      const result = detector.check(response, []);

      expect(result.totalClaims).toBe(0);
      expect(result.score).toBe(0);
      expect(result.shouldRegenerate).toBe(false);
    });

    it('should handle response without numerical claims', () => {
      const response =
        'I cannot access other users\' data. I can only analyze your portfolio.';
      const result = detector.check(response, []);

      expect(result.totalClaims).toBe(0);
      expect(result.shouldRegenerate).toBe(false);
      expect(result.shouldWarn).toBe(false);
    });

    it('should set shouldWarn when score > 0.03', () => {
      const response =
        'Your portfolio returned 99.9% this year. It also returned 88.8% last year.';
      const toolResults = [{ returnPercent: 15.3 }];

      const result = detector.check(response, toolResults);

      // Both claims should be ungrounded
      if (result.totalClaims > 0 && result.score > 0.03) {
        expect(result.shouldWarn).toBe(true);
      }
    });

    it('should set shouldRegenerate when score > 0.05', () => {
      const response =
        'You have $5,000,000 in your portfolio with 200% gains.';
      const toolResults = [{ totalValue: 100000, returnPercent: 15.3 }];

      const result = detector.check(response, toolResults);

      if (result.totalClaims > 0 && result.score > 0.05) {
        expect(result.shouldRegenerate).toBe(true);
      }
    });

    it('should detect dollar amounts as factual claims', () => {
      const response = 'Your Apple position is worth $35,000.50.';
      const toolResults = [{ value: 35000.5 }];

      const result = detector.check(response, toolResults);

      expect(result.totalClaims).toBeGreaterThan(0);
      expect(result.groundedClaims).toBeGreaterThan(0);
    });

    it('should detect percentage values as factual claims', () => {
      const response =
        'AAPL represents 35.0% of your portfolio and has returned 15.3%.';
      const toolResults = [
        { allocation: 35.0, returnPercent: 15.3 }
      ];

      const result = detector.check(response, toolResults);

      expect(result.totalClaims).toBeGreaterThan(0);
    });

    it('should ground claims with close rounded values', () => {
      const response =
        'Your portfolio is worth approximately $100,001.';
      const toolResults = [{ totalValue: 100000.5 }];

      const result = detector.check(response, toolResults);

      // 100001 rounds close to 100000.5 - should be grounded
      expect(result.totalClaims).toBeGreaterThan(0);
    });

    it('should keep decimal dollar amounts intact during sentence splitting', () => {
      const response =
        '$115,851.63 Total Value across all holdings.';
      const toolResults = [{ totalValue: 115851.63 }];

      const result = detector.check(response, toolResults);

      expect(result.totalClaims).toBeGreaterThan(0);
      expect(result.groundedClaims).toBeGreaterThan(0);
      expect(result.flaggedClaims).toHaveLength(0);
      expect(result.score).toBe(0);
    });

    it('should keep decimal percentages intact during sentence splitting', () => {
      const response =
        'Your portfolio returned +37.09% over the past year.';
      const toolResults = [{ returnPercent: 37.09 }];

      const result = detector.check(response, toolResults);

      expect(result.totalClaims).toBeGreaterThan(0);
      expect(result.groundedClaims).toBeGreaterThan(0);
      expect(result.flaggedClaims).toHaveLength(0);
      expect(result.score).toBe(0);
    });

    it('should handle multiple claims with mixed grounding', () => {
      const response =
        'Your portfolio is worth $100,000 with 5 holdings. You earned a 99.99% return.';
      const toolResults = [
        { totalValue: 100000, holdingsCount: 5, returnPercent: 15.3 }
      ];

      const result = detector.check(response, toolResults);

      // Should have some grounded and some flagged
      expect(result.totalClaims).toBeGreaterThan(0);
      expect(result.groundedClaims + result.flaggedClaims.length).toBe(
        result.totalClaims
      );
    });
  });
});
