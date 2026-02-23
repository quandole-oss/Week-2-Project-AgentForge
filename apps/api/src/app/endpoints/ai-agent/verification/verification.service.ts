import { Injectable, Logger } from '@nestjs/common';

const DISCLAIMER =
  'This information is for educational purposes only and does not constitute financial advice. ' +
  'Please consult a qualified financial advisor before making investment decisions.';

const DISCLAIMER_PATTERN =
  /financial advice|consult.*advisor|educational purposes|not.*recommendation/i;

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  public enforceDisclaimer(response: string): string {
    if (!DISCLAIMER_PATTERN.test(response)) {
      this.logger.debug('Disclaimer not found in response, injecting');
      return `${response}\n\n---\n*${DISCLAIMER}*`;
    }

    return response;
  }

  public getDisclaimer(): string {
    return DISCLAIMER;
  }

  public validateSourceAttribution(
    response: string,
    toolCallsMade: string[]
  ): { valid: boolean; missingAttribution: string[] } {
    const missingAttribution: string[] = [];

    for (const toolName of toolCallsMade) {
      const toolRef = toolName.replace(/_/g, ' ');
      const hasReference =
        response.toLowerCase().includes(toolRef) ||
        response.toLowerCase().includes(toolName);

      if (!hasReference) {
        missingAttribution.push(toolName);
      }
    }

    return {
      valid: missingAttribution.length === 0,
      missingAttribution
    };
  }

  public extractNumbers(text: string): number[] {
    const matches = text.match(
      /(?<!\w)-?\d{1,3}(?:,\d{3})*(?:\.\d+)?%?(?!\w)/g
    );
    if (!matches) {
      return [];
    }

    return matches.map((match) => {
      const cleaned = match.replace(/[,%]/g, '');
      return parseFloat(cleaned);
    });
  }

  public verifyNumericalAccuracy(
    responseNumbers: number[],
    toolResultNumbers: number[],
    tolerancePercent = 0.01
  ): { accurate: boolean; mismatches: { response: number; closest: number; drift: number }[] } {
    const mismatches: { response: number; closest: number; drift: number }[] = [];

    for (const num of responseNumbers) {
      if (num === 0 || Math.abs(num) < 0.001) {
        continue;
      }

      const closest = toolResultNumbers.reduce(
        (prev, curr) =>
          Math.abs(curr - num) < Math.abs(prev - num) ? curr : prev,
        toolResultNumbers[0] ?? 0
      );

      const drift = Math.abs((num - closest) / closest);

      if (drift > tolerancePercent && Math.abs(num - closest) > 0.01) {
        mismatches.push({ response: num, closest, drift });
      }
    }

    return {
      accurate: mismatches.length === 0,
      mismatches
    };
  }

  public assessConfidence(
    toolCallCount: number,
    hasErrors: boolean,
    responseLength: number
  ): number {
    let confidence = 0.8;

    if (toolCallCount === 0) {
      confidence -= 0.3;
    }

    if (hasErrors) {
      confidence -= 0.2;
    }

    if (responseLength < 50) {
      confidence -= 0.1;
    }

    return Math.max(0, Math.min(1, confidence));
  }
}
