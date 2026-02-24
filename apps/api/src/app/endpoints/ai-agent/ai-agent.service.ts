import { ConfigurationService } from '@ghostfolio/api/services/configuration/configuration.service';
import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { PROPERTY_API_KEY_ANTHROPIC } from '@ghostfolio/common/config';
import type {
  AiAgentMessage,
  AiAgentResponse,
  AiAgentToolCall
} from '@ghostfolio/common/interfaces';
import type { RequestWithUser } from '@ghostfolio/common/types';

import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger
} from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, streamText, tool } from 'ai';
import { z } from 'zod';

import { AllocationOptimizerTool } from './tools/allocation-optimizer.tool';
import { ComplianceCheckerTool } from './tools/compliance-checker.tool';
import { MarketContextTool } from './tools/market-context.tool';
import { PortfolioSummaryTool } from './tools/portfolio-summary.tool';
import { TaxEstimatorTool } from './tools/tax-estimator.tool';
import { TransactionAnalyzerTool } from './tools/transaction-analyzer.tool';
import { TelemetryService } from './telemetry/telemetry.service';
import { HallucinationDetector } from './verification/hallucination-detector';
import { VerificationService } from './verification/verification.service';

// Haiku pricing: $0.80/1M input, $4.00/1M output
const HAIKU_INPUT_COST_PER_TOKEN = 0.8 / 1_000_000;
const HAIKU_OUTPUT_COST_PER_TOKEN = 4.0 / 1_000_000;

const DAILY_COST_CAP = 5.0; // $5/day cap

const SYSTEM_PROMPT = `You are a read-only financial portfolio assistant for Ghostfolio. You help users understand their portfolio, holdings, transactions, taxes, compliance, and allocation.

RULES:
1. READ-ONLY. Never suggest executing trades or modifying the portfolio. If asked to buy/sell, explain you can only analyze.
2. Include a disclaimer that your analysis is educational only, not financial advice.
3. Only reference data from your tools. Never fabricate holdings, prices, or figures.
4. Use exact values from tool results. Do not round unless explicitly stated.
5. If a tool returns an error, clearly state the limitation.
6. Never access other users' data.
7. Structure responses clearly when presenting complex data.

If confidence is low due to partial data, add uncertainty language and recommend consulting a professional. Always end with a disclaimer about seeking professional financial advice.`;

@Injectable()
export class AiAgentService {
  private readonly logger = new Logger(AiAgentService.name);
  private static dailyCostTracker = { date: '', totalCost: 0 };

  public constructor(
    private readonly allocationOptimizerTool: AllocationOptimizerTool,
    private readonly complianceCheckerTool: ComplianceCheckerTool,
    private readonly configurationService: ConfigurationService,
    private readonly hallucinationDetector: HallucinationDetector,
    private readonly marketContextTool: MarketContextTool,
    private readonly portfolioSummaryTool: PortfolioSummaryTool,
    private readonly prismaService: PrismaService,
    private readonly propertyService: PropertyService,
    private readonly taxEstimatorTool: TaxEstimatorTool,
    private readonly telemetryService: TelemetryService,
    private readonly transactionAnalyzerTool: TransactionAnalyzerTool,
    private readonly verificationService: VerificationService,
    @Inject(REQUEST) private readonly request: RequestWithUser
  ) {}

  public async chat({
    conversationHistory = [],
    message
  }: {
    conversationHistory?: AiAgentMessage[];
    message: string;
  }): Promise<AiAgentResponse> {
    const isEnabled = this.configurationService.get(
      'ENABLE_FEATURE_AI_AGENT'
    );

    if (!isEnabled) {
      throw new HttpException(
        'AI Agent feature is not enabled',
        HttpStatus.FORBIDDEN
      );
    }

    const apiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_ANTHROPIC
    );

    if (!apiKey) {
      throw new HttpException(
        'Anthropic API key is not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    if (AiAgentService.dailyCostTracker.date !== today) {
      AiAgentService.dailyCostTracker = { date: today, totalCost: 0 };
    }

    if (AiAgentService.dailyCostTracker.totalCost >= DAILY_COST_CAP) {
      throw new HttpException(
        'Daily AI agent budget exceeded. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const userId = this.request.user.id;
    const userCurrency =
      this.request.user.settings?.settings?.baseCurrency ?? 'USD';
    const impersonationId = undefined;
    const startTime = performance.now();
    const traceId = this.telemetryService.createTraceId();
    const trace = this.telemetryService.createTrace({
      traceId,
      name: 'ai-agent-chat',
      userId,
      input: message
    });

    this.logger.log(
      `[${traceId}] Chat request from user ${userId}: "${message.substring(0, 100)}"`
    );

    const anthropic = createAnthropic({ apiKey });

    const messages = [
      ...conversationHistory.slice(-10).map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user' as const, content: message }
    ];

    const toolCallsLog: AiAgentToolCall[] = [];

    const tools = {
      portfolio_summary: tool({
        description:
          'Get a comprehensive summary of the user\'s investment portfolio including holdings, allocation percentages, asset classes, current values, and overall performance metrics. Use this when the user asks about their portfolio overview, holdings, or allocation.',
        parameters: z.object({
          withMarkets: z
            .boolean()
            .optional()
            .describe('Include market data for each holding'),
          withSummary: z
            .boolean()
            .optional()
            .describe('Include summary statistics')
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.portfolioSummaryTool.execute({
                ...args,
                impersonationId,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'portfolio_summary',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool portfolio_summary failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'portfolio_summary',
              args,
              result: errorResult,
              durationMs
            });
            this.logger.warn(
              `[${traceId}] Tool portfolio_summary failed after ${durationMs}ms: ${error.message}`
            );
            return errorResult;
          }
        }
      }),

      transaction_analyzer: tool({
        description:
          'Analyze the user\'s transaction history including activity counts by type and month, total fees, and date ranges. Use this when the user asks about their transactions, trading activity, fees, or order history.',
        parameters: z.object({
          startDate: z
            .string()
            .optional()
            .describe('Start date filter (ISO 8601)'),
          endDate: z
            .string()
            .optional()
            .describe('End date filter (ISO 8601)'),
          types: z
            .array(z.string())
            .optional()
            .describe(
              'Filter by activity types: BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY'
            )
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.transactionAnalyzerTool.execute({
                ...args,
                userCurrency,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'transaction_analyzer',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool transaction_analyzer failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'transaction_analyzer',
              args,
              result: errorResult,
              durationMs
            });
            this.logger.warn(
              `[${traceId}] Tool transaction_analyzer failed after ${durationMs}ms: ${error.message}`
            );
            return errorResult;
          }
        }
      }),

      market_context: tool({
        description:
          'Get current market prices, currency, and market state for specific symbols. Use this when the user asks about current prices, market conditions, or wants to compare holdings to market data.',
        parameters: z.object({
          symbols: z
            .array(
              z.object({
                symbol: z.string().describe('The ticker symbol'),
                dataSource: z
                  .string()
                  .describe(
                    'Data source (e.g., YAHOO, COINGECKO, MANUAL)'
                  )
              })
            )
            .describe('Array of symbol and data source pairs')
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.marketContextTool.execute({
                symbols: args.symbols as { symbol: string; dataSource: string }[]
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'market_context',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool market_context failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'market_context',
              args,
              result: errorResult,
              durationMs
            });
            this.logger.warn(
              `[${traceId}] Tool market_context failed after ${durationMs}ms: ${error.message}`
            );
            return errorResult;
          }
        }
      }),

      tax_estimator: tool({
        description:
          'Estimate capital gains and tax liability using FIFO lot matching. Use this when the user asks about taxes, capital gains, realized/unrealized gains, or cost basis.',
        parameters: z.object({
          taxYear: z
            .number()
            .describe('The tax year to estimate for'),
          jurisdiction: z
            .string()
            .optional()
            .describe('Tax jurisdiction (US-only in v1)'),
          lotMethod: z
            .string()
            .optional()
            .describe('Lot matching method (FIFO default)')
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.taxEstimatorTool.execute({
                ...args,
                taxYear: args.taxYear as number,
                userCurrency,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'tax_estimator',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool tax_estimator failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'tax_estimator',
              args,
              result: errorResult,
              durationMs
            });
            this.logger.warn(
              `[${traceId}] Tool tax_estimator failed after ${durationMs}ms: ${error.message}`
            );
            return errorResult;
          }
        }
      }),

      compliance_checker: tool({
        description:
          'Check the portfolio for compliance issues including concentration risk, diversification, and currency exposure. Use this when the user asks about portfolio risks, compliance, or diversification issues.',
        parameters: z.object({
          ruleSet: z
            .array(z.string())
            .optional()
            .describe(
              'Rules to check: concentration, diversification, currency'
            )
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.complianceCheckerTool.execute({
                ...args,
                impersonationId,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'compliance_checker',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool compliance_checker failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'compliance_checker',
              args,
              result: errorResult,
              durationMs
            });
            this.logger.warn(
              `[${traceId}] Tool compliance_checker failed after ${durationMs}ms: ${error.message}`
            );
            return errorResult;
          }
        }
      }),

      allocation_optimizer: tool({
        description:
          'Compare current portfolio allocation against a target allocation and suggest rebalancing. Use this when the user asks about rebalancing, target allocation, or portfolio optimization.',
        parameters: z.object({
          targetAllocation: z
            .record(z.number())
            .describe(
              'Target allocation as asset class to percentage (0-1). E.g., {"EQUITY": 0.6, "FIXED_INCOME": 0.3, "LIQUIDITY": 0.1}'
            )
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.allocationOptimizerTool.execute({
                targetAllocation: args.targetAllocation as Record<string, number>,
                impersonationId,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'allocation_optimizer',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool allocation_optimizer failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'allocation_optimizer',
              args,
              result: errorResult,
              durationMs
            });
            this.logger.warn(
              `[${traceId}] Tool allocation_optimizer failed after ${durationMs}ms: ${error.message}`
            );
            return errorResult;
          }
        }
      })
    };

    const MAX_RETRIES = 1;

    try {
      let responseText = '';
      let hasVerificationErrors = false;
      let stepsCount = 0;
      let usage: { promptTokens: number; completionTokens: number } = {
        promptTokens: 0,
        completionTokens: 0
      };
      let lastHallucinationScore: number | undefined;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          toolCallsLog.length = 0;
          this.logger.warn(
            `[${traceId}] Retry attempt ${attempt}/${MAX_RETRIES} due to verification failure`
          );
        }

        const generation = this.telemetryService.createGeneration({
          trace,
          name: 'chat-completion',
          model: 'claude-haiku-4-5-20251001',
          input: messages
        });

        const result = await generateText({
          model: anthropic('claude-haiku-4-5-20251001'),
          system: SYSTEM_PROMPT,
          messages,
          tools,
          maxSteps: 3,
          abortSignal: AbortSignal.timeout(25_000),
          experimental_telemetry: {
            isEnabled: true,
            metadata: {
              langfuseTraceId: traceId,
              langfuseUserId: userId,
              langfuseSessionId: `session-${userId}`,
              langfuseTags: ['ai-agent', 'ghostfolio']
            }
          }
        });

        // Step 1: Extract token usage from result
        usage = {
          promptTokens: result.usage?.promptTokens ?? 0,
          completionTokens: result.usage?.completionTokens ?? 0
        };
        stepsCount = result.steps?.length ?? 1;

        this.telemetryService.endGeneration({
          generation,
          output: result.text,
          usage: {
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.promptTokens + usage.completionTokens
          }
        });

        responseText = this.verificationService.enforceDisclaimer(
          result.text
        );

        // Phase 6: Numerical accuracy verification
        if (toolCallsLog.length > 0) {
          const responseNumbers =
            this.verificationService.extractNumbers(responseText);
          const toolResultNumbers =
            this.verificationService.extractNumbers(
              JSON.stringify(toolCallsLog.map((tc) => tc.result))
            );

          if (
            responseNumbers.length > 0 &&
            toolResultNumbers.length > 0
          ) {
            const accuracy =
              this.verificationService.verifyNumericalAccuracy(
                responseNumbers,
                toolResultNumbers
              );

            if (!accuracy.accurate) {
              this.logger.warn(
                `[${traceId}] Numerical accuracy check failed (attempt ${attempt + 1}): ${JSON.stringify(accuracy.mismatches)}`
              );

              if (attempt < MAX_RETRIES) {
                hasVerificationErrors = true;
                continue;
              }
            }
          }

          // Phase 6: Hallucination detection
          const hallucinationResult = this.hallucinationDetector.check(
            responseText,
            toolCallsLog.map((tc) => tc.result as Record<string, unknown>)
          );
          lastHallucinationScore = hallucinationResult.score;

          if (hallucinationResult.shouldRegenerate && attempt < MAX_RETRIES) {
            this.logger.warn(
              `[${traceId}] Hallucination detected (score: ${hallucinationResult.score.toFixed(2)}, attempt ${attempt + 1})`
            );
            hasVerificationErrors = true;
            continue;
          }

          if (hallucinationResult.shouldWarn) {
            responseText +=
              '\n\n*Note: Some claims in this response could not be fully verified against the source data. Please cross-reference important figures.*';
          }
        }

        // Passed verification — break the retry loop
        hasVerificationErrors = false;
        break;
      }

      const duration = this.telemetryService.measureDuration(startTime);
      const confidence = this.verificationService.assessConfidence(
        toolCallsLog.length,
        hasVerificationErrors,
        responseText.length
      );

      // Phase 6: Low confidence uncertainty language
      if (confidence < 0.7) {
        responseText +=
          '\n\n*Note: This analysis has limited confidence due to incomplete data. Please consult a qualified financial professional for important decisions.*';
      }

      // Report scores to Langfuse
      this.telemetryService.reportLangfuseScores({
        traceId,
        confidence,
        hallucinationScore: lastHallucinationScore,
        toolCallCount: toolCallsLog.length
      });

      // Flush Langfuse to ensure traces are sent
      this.telemetryService.flush().catch((err) => {
        this.logger.warn(`[${traceId}] Langfuse flush failed: ${err.message}`);
      });

      // Calculate cost
      const totalTokens = usage.promptTokens + usage.completionTokens;
      const cost =
        usage.promptTokens * HAIKU_INPUT_COST_PER_TOKEN +
        usage.completionTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

      AiAgentService.dailyCostTracker.totalCost += cost;

      // Structured telemetry via TelemetryService
      this.telemetryService.logRequest({
        type: 'ai_agent_telemetry',
        traceId,
        userId,
        duration,
        toolCalls: toolCallsLog.map((t) => t.toolName),
        toolCallCount: toolCallsLog.length,
        toolTimings: toolCallsLog.map((t) => ({
          name: t.toolName,
          durationMs: t.durationMs ?? 0
        })),
        steps: stepsCount,
        confidence,
        tokensUsed: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens
        },
        cost,
        messageLength: responseText.length,
        timestamp: new Date().toISOString()
      });

      const sources = toolCallsLog.map((tc) => ({
        service: tc.toolName,
        timestamp: new Date().toISOString()
      }));

      return {
        message: {
          role: 'assistant',
          content: responseText,
          timestamp: new Date().toISOString()
        },
        traceId,
        toolCalls:
          toolCallsLog.length > 0 ? toolCallsLog : undefined,
        confidence,
        disclaimer: this.verificationService.getDisclaimer(),
        sources,
        usage: {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens,
          cost
        },
        durationMs: duration
      };
    } catch (error) {
      const duration = this.telemetryService.measureDuration(startTime);
      const errorCategory = this.telemetryService.categorizeError(error);

      this.telemetryService.logError({
        type: 'ai_agent_error',
        traceId,
        userId,
        duration,
        error: error.message,
        errorCategory,
        stack: error.stack,
        context: {
          toolCallsCompleted: toolCallsLog.map((t) => t.toolName),
          retryAttempt: toolCallsLog.length > 0 ? 1 : 0
        },
        timestamp: new Date().toISOString()
      });

      if (errorCategory === 'timeout_error') {
        throw new HttpException(
          'The AI agent request timed out. Please try a simpler question or try again later.',
          HttpStatus.GATEWAY_TIMEOUT
        );
      }

      throw new HttpException(
        'Failed to process chat request',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  public async chatStream({
    conversationHistory = [],
    message
  }: {
    conversationHistory?: AiAgentMessage[];
    message: string;
  }) {
    const isEnabled = this.configurationService.get(
      'ENABLE_FEATURE_AI_AGENT'
    );

    if (!isEnabled) {
      throw new HttpException(
        'AI Agent feature is not enabled',
        HttpStatus.FORBIDDEN
      );
    }

    const apiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_ANTHROPIC
    );

    if (!apiKey) {
      throw new HttpException(
        'Anthropic API key is not configured',
        HttpStatus.SERVICE_UNAVAILABLE
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    if (AiAgentService.dailyCostTracker.date !== today) {
      AiAgentService.dailyCostTracker = { date: today, totalCost: 0 };
    }

    if (AiAgentService.dailyCostTracker.totalCost >= DAILY_COST_CAP) {
      throw new HttpException(
        'Daily AI agent budget exceeded. Please try again tomorrow.',
        HttpStatus.TOO_MANY_REQUESTS
      );
    }

    const userId = this.request.user.id;
    const userCurrency =
      this.request.user.settings?.settings?.baseCurrency ?? 'USD';
    const impersonationId = undefined;
    const startTime = performance.now();
    const traceId = this.telemetryService.createTraceId();
    const trace = this.telemetryService.createTrace({
      traceId,
      name: 'ai-agent-chat-stream',
      userId,
      input: message
    });

    this.logger.log(
      `[${traceId}] Stream request from user ${userId}: "${message.substring(0, 100)}"`
    );

    const anthropic = createAnthropic({ apiKey });

    const messages = [
      ...conversationHistory.slice(-10).map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user' as const, content: message }
    ];

    const toolCallsLog: AiAgentToolCall[] = [];
    let resolveToolNames: (names: string[]) => void;
    const toolNamesPromise = new Promise<string[]>((resolve) => {
      resolveToolNames = resolve;
    });

    const tools = {
      portfolio_summary: tool({
        description:
          'Get a comprehensive summary of the user\'s investment portfolio including holdings, allocation percentages, asset classes, current values, and overall performance metrics. Use this when the user asks about their portfolio overview, holdings, or allocation.',
        parameters: z.object({
          withMarkets: z
            .boolean()
            .optional()
            .describe('Include market data for each holding'),
          withSummary: z
            .boolean()
            .optional()
            .describe('Include summary statistics')
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.portfolioSummaryTool.execute({
                ...args,
                impersonationId,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'portfolio_summary',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool portfolio_summary failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'portfolio_summary',
              args,
              result: errorResult,
              durationMs
            });
            return errorResult;
          }
        }
      }),

      transaction_analyzer: tool({
        description:
          'Analyze the user\'s transaction history including activity counts by type and month, total fees, and date ranges. Use this when the user asks about their transactions, trading activity, fees, or order history.',
        parameters: z.object({
          startDate: z
            .string()
            .optional()
            .describe('Start date filter (ISO 8601)'),
          endDate: z
            .string()
            .optional()
            .describe('End date filter (ISO 8601)'),
          types: z
            .array(z.string())
            .optional()
            .describe(
              'Filter by activity types: BUY, SELL, DIVIDEND, FEE, INTEREST, LIABILITY'
            )
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.transactionAnalyzerTool.execute({
                ...args,
                userCurrency,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'transaction_analyzer',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool transaction_analyzer failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'transaction_analyzer',
              args,
              result: errorResult,
              durationMs
            });
            return errorResult;
          }
        }
      }),

      market_context: tool({
        description:
          'Get current market prices, currency, and market state for specific symbols. Use this when the user asks about current prices, market conditions, or wants to compare holdings to market data.',
        parameters: z.object({
          symbols: z
            .array(
              z.object({
                symbol: z.string().describe('The ticker symbol'),
                dataSource: z
                  .string()
                  .describe(
                    'Data source (e.g., YAHOO, COINGECKO, MANUAL)'
                  )
              })
            )
            .describe('Array of symbol and data source pairs')
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.marketContextTool.execute({
                symbols: args.symbols as { symbol: string; dataSource: string }[]
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'market_context',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool market_context failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'market_context',
              args,
              result: errorResult,
              durationMs
            });
            return errorResult;
          }
        }
      }),

      tax_estimator: tool({
        description:
          'Estimate capital gains and tax liability using FIFO lot matching. Use this when the user asks about taxes, capital gains, realized/unrealized gains, or cost basis.',
        parameters: z.object({
          taxYear: z
            .number()
            .describe('The tax year to estimate for'),
          jurisdiction: z
            .string()
            .optional()
            .describe('Tax jurisdiction (US-only in v1)'),
          lotMethod: z
            .string()
            .optional()
            .describe('Lot matching method (FIFO default)')
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.taxEstimatorTool.execute({
                ...args,
                taxYear: args.taxYear as number,
                userCurrency,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'tax_estimator',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool tax_estimator failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'tax_estimator',
              args,
              result: errorResult,
              durationMs
            });
            return errorResult;
          }
        }
      }),

      compliance_checker: tool({
        description:
          'Check the portfolio for compliance issues including concentration risk, diversification, and currency exposure. Use this when the user asks about portfolio risks, compliance, or diversification issues.',
        parameters: z.object({
          ruleSet: z
            .array(z.string())
            .optional()
            .describe(
              'Rules to check: concentration, diversification, currency'
            )
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.complianceCheckerTool.execute({
                ...args,
                impersonationId,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'compliance_checker',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool compliance_checker failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'compliance_checker',
              args,
              result: errorResult,
              durationMs
            });
            return errorResult;
          }
        }
      }),

      allocation_optimizer: tool({
        description:
          'Compare current portfolio allocation against a target allocation and suggest rebalancing. Use this when the user asks about rebalancing, target allocation, or portfolio optimization.',
        parameters: z.object({
          targetAllocation: z
            .record(z.number())
            .describe(
              'Target allocation as asset class to percentage (0-1). E.g., {"EQUITY": 0.6, "FIXED_INCOME": 0.3, "LIQUIDITY": 0.1}'
            )
        }),
        execute: async (args) => {
          const toolStart = performance.now();
          try {
            const toolResult =
              await this.allocationOptimizerTool.execute({
                targetAllocation: args.targetAllocation as Record<string, number>,
                impersonationId,
                userId
              });
            const durationMs = Math.round(performance.now() - toolStart);
            toolCallsLog.push({
              toolName: 'allocation_optimizer',
              args,
              result: toolResult,
              durationMs
            });
            return toolResult;
          } catch (error) {
            const durationMs = Math.round(performance.now() - toolStart);
            const errorResult = {
              error: true,
              message: `Tool allocation_optimizer failed: ${error.message}`
            };
            toolCallsLog.push({
              toolName: 'allocation_optimizer',
              args,
              result: errorResult,
              durationMs
            });
            return errorResult;
          }
        }
      })
    };

    const generation = this.telemetryService.createGeneration({
      trace,
      name: 'chat-stream-completion',
      model: 'claude-haiku-4-5-20251001',
      input: messages
    });

    const result = streamText({
      model: anthropic('claude-haiku-4-5-20251001'),
      system: SYSTEM_PROMPT,
      messages,
      tools,
      maxSteps: 3,
      abortSignal: AbortSignal.timeout(30_000),
      experimental_telemetry: {
        isEnabled: true,
        metadata: {
          langfuseTraceId: traceId,
          langfuseUserId: userId,
          langfuseSessionId: `session-${userId}`,
          langfuseTags: ['ai-agent', 'ghostfolio']
        }
      },
      onFinish: async ({ text, usage: finishUsage }) => {
        try {
          const duration =
            this.telemetryService.measureDuration(startTime);
          const promptTokens = finishUsage?.promptTokens ?? 0;
          const completionTokens = finishUsage?.completionTokens ?? 0;
          const totalTokens = promptTokens + completionTokens;

          this.telemetryService.endGeneration({
            generation,
            output: text,
            usage: { promptTokens, completionTokens, totalTokens }
          });

          let responseText =
            this.verificationService.enforceDisclaimer(text);

          let lastHallucinationScore: number | undefined;

          if (toolCallsLog.length > 0) {
            const hallucinationResult =
              this.hallucinationDetector.check(
                responseText,
                toolCallsLog.map(
                  (tc) => tc.result as Record<string, unknown>
                )
              );
            lastHallucinationScore = hallucinationResult.score;
          }

          const confidence =
            this.verificationService.assessConfidence(
              toolCallsLog.length,
              false,
              responseText.length
            );

          this.telemetryService.reportLangfuseScores({
            traceId,
            confidence,
            hallucinationScore: lastHallucinationScore,
            toolCallCount: toolCallsLog.length
          });

          const cost =
            promptTokens * HAIKU_INPUT_COST_PER_TOKEN +
            completionTokens * HAIKU_OUTPUT_COST_PER_TOKEN;

          AiAgentService.dailyCostTracker.totalCost += cost;

          this.telemetryService.logRequest({
            type: 'ai_agent_telemetry',
            traceId,
            userId,
            duration,
            toolCalls: toolCallsLog.map((t) => t.toolName),
            toolCallCount: toolCallsLog.length,
            toolTimings: toolCallsLog.map((t) => ({
              name: t.toolName,
              durationMs: t.durationMs ?? 0
            })),
            steps: 1,
            confidence,
            tokensUsed: {
              promptTokens,
              completionTokens,
              totalTokens
            },
            cost,
            messageLength: responseText.length,
            timestamp: new Date().toISOString()
          });

          await this.telemetryService.flush();
        } catch (err) {
          this.logger.warn(
            `[${traceId}] Stream onFinish telemetry failed: ${err.message}`
          );
        } finally {
          resolveToolNames(toolCallsLog.map((t) => t.toolName));
        }
      }
    });

    return { result, traceId, toolNamesPromise };
  }

  public async submitFeedback({
    traceId,
    rating,
    correction,
    userId
  }: {
    traceId: string;
    rating: 'up' | 'down';
    correction?: string;
    userId: string;
  }) {
    const feedback = await this.prismaService.aiAgentFeedback.create({
      data: {
        traceId,
        rating,
        correction,
        userId
      }
    });

    this.logger.log(
      JSON.stringify({
        type: 'ai_agent_feedback',
        traceId,
        userId,
        rating,
        hasCorrection: !!correction,
        timestamp: new Date().toISOString()
      })
    );

    // Report user feedback to Langfuse
    this.telemetryService.reportLangfuseScore({
      traceId,
      name: 'user-feedback',
      value: rating === 'up' ? 1 : 0,
      comment: correction
    });

    return feedback;
  }
}
