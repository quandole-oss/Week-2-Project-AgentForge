import { Injectable, Logger } from '@nestjs/common';

export interface HallucinationCheckResult {
  score: number; // 0-1, where 0 = no hallucination, 1 = fully hallucinated
  flaggedClaims: string[];
  groundedClaims: number;
  totalClaims: number;
  shouldRegenerate: boolean;
  shouldWarn: boolean;
}

@Injectable()
export class HallucinationDetector {
  private readonly logger = new Logger(HallucinationDetector.name);

  public check(
    responseText: string,
    toolResults: Record<string, unknown>[]
  ): HallucinationCheckResult {
    const claims = this.extractFactualClaims(responseText);
    const toolDataString = JSON.stringify(toolResults).toLowerCase();
    const flaggedClaims: string[] = [];
    let groundedClaims = 0;

    for (const claim of claims) {
      if (this.isClaimGrounded(claim, toolDataString)) {
        groundedClaims++;
      } else {
        flaggedClaims.push(claim);
      }
    }

    const totalClaims = claims.length;
    const score =
      totalClaims > 0 ? flaggedClaims.length / totalClaims : 0;

    const result: HallucinationCheckResult = {
      score,
      flaggedClaims,
      groundedClaims,
      totalClaims,
      shouldRegenerate: score > 0.05,
      shouldWarn: score > 0.03
    };

    if (result.shouldWarn) {
      this.logger.warn(
        `Hallucination check: ${flaggedClaims.length}/${totalClaims} claims ungrounded (score: ${score.toFixed(2)})`
      );
    }

    return result;
  }

  private extractFactualClaims(text: string): string[] {
    const claims: string[] = [];

    // Protect decimal points (digit.digit) from sentence splitting
    const DECIMAL_PLACEHOLDER = '\u0000';
    const safeText = text.replace(
      /(\d)\.(\d)/g,
      `$1${DECIMAL_PLACEHOLDER}$2`
    );
    const sentences = safeText
      .split(/[.!?]+/)
      .filter((s) => s.trim())
      .map((s) => s.replace(/\u0000/g, '.'));

    for (const sentence of sentences) {
      const trimmed = sentence.trim();

      // Look for sentences containing numerical data
      if (/\d+[.,]?\d*\s*%/.test(trimmed)) {
        claims.push(trimmed);
      } else if (/\$[\d,]+\.?\d*/.test(trimmed)) {
        claims.push(trimmed);
      } else if (/[\d,]+\.\d{2,}/.test(trimmed)) {
        claims.push(trimmed);
      }
    }

    return claims;
  }

  private isClaimGrounded(
    claim: string,
    toolDataString: string
  ): boolean {
    // Extract all numbers from the claim
    const numbers = claim.match(
      /(?<!\w)-?\d{1,3}(?:,\d{3})*(?:\.\d+)?(?!\w)/g
    );

    if (!numbers || numbers.length === 0) {
      // No specific numbers to verify — give benefit of the doubt
      return true;
    }

    // Check if at least one significant number appears in tool data
    for (const numStr of numbers) {
      const cleaned = numStr.replace(/,/g, '');
      const num = parseFloat(cleaned);

      if (isNaN(num) || Math.abs(num) < 0.01) {
        continue;
      }

      // Exact and string forms
      if (
        toolDataString.includes(cleaned) ||
        toolDataString.includes(num.toString())
      ) {
        return true;
      }

      // Rounding tolerance (2, 1, 0 decimals)
      const rounded2 = num.toFixed(2);
      const rounded1 = num.toFixed(1);
      const rounded0 = Math.round(num).toString();

      if (
        toolDataString.includes(rounded2) ||
        toolDataString.includes(rounded1) ||
        toolDataString.includes(rounded0)
      ) {
        return true;
      }

      // One-decimal form without trailing zero (e.g. 30.82 -> "30.8" so tool "30.8" matches)
      const oneDecimalTrimmed = parseFloat(num.toFixed(1)).toString();
      if (toolDataString.includes(oneDecimalTrimmed)) {
        return true;
      }

      // Percentage as decimal in tool (e.g. 30.82% in response, 0.3082 or 0.308 in tool)
      if (num >= 0 && num <= 100) {
        const asDecimal = num / 100;
        const decimalVariants = [
          asDecimal.toFixed(4),
          asDecimal.toFixed(3),
          asDecimal.toFixed(2)
        ];
        if (
          decimalVariants.some((v) => toolDataString.includes(v))
        ) {
          return true;
        }
      }
    }

    return false;
  }
}
