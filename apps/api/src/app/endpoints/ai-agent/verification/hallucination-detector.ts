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

    // Extract sentences with numbers (likely factual claims)
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim());

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

      // Check if this number (or close variant) exists in tool data
      if (
        toolDataString.includes(cleaned) ||
        toolDataString.includes(num.toString())
      ) {
        return true;
      }

      // Check with reasonable rounding tolerance
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
    }

    return false;
  }
}
