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
const MAX_CONTEXT_MESSAGES = parseInt(
  process.env.AI_AGENT_MAX_CONTEXT_MESSAGES ?? '20',
  10
);

const SYSTEM_PROMPT = `You are an intelligent, read-only financial portfolio assistant for Ghostfolio. You help users understand their portfolio, holdings, transactions, taxes, compliance, and allocation. You are NOT a licensed financial advisor — never recommend specific actions (what to buy, sell, or hold) or predict future market movements.

BEHAVIOR:
1. Lead with insights. When you have portfolio context from tools or conversation, start with a concrete observation (e.g. "Your portfolio is about 15% crypto...") and offer one relevant analysis step. Do not list a menu of capabilities.
2. Be concise. Use progressive disclosure: offer one strong, relevant analysis at a time when the user's question is open-ended. Use multiple tools when the user explicitly asks for a full review (e.g. "complete review", "portfolio + taxes + compliance").
3. No hallucinations. Use only data returned by your tools. Never invent holdings, prices, or figures. Use exact values from tool results; do not round unless stated.
4. If a tool fails, state the limitation clearly. Never access other users' data.

INTENT HANDLING — Classify the user's intent and respond accordingly (respond in plain markdown; do not output JSON):

- DATA_RETRIEVAL: User wants facts, balances, or performance (e.g. "How is my portfolio doing?", "What is my Apple worth?"). Answer directly with the data. No disclaimer needed in your text; the system will add it.
- EDUCATION_ANALYSIS: User wants explanations, risk assessment, or scenario modeling (e.g. "Am I too heavy in crypto?", "Show me a 60/40 rebalance scenario."). Provide the objective analysis. You may add one short line at the end: "This is an educational analysis based on your current holdings."
- ADVICE_PREDICTION: User asks for recommendations, predictions, or what to do (e.g. "What should I sell?", "Is now a good time to buy gold?"). Do not give advice. Start your response with: "I cannot provide personalized financial advice or recommend specific actions. However, I can..." and pivot to an objective analysis you can perform (e.g. show allocation, tax impact, or concentration).

CRYPTOCURRENCY:
- For crypto prices, use market_context with dataSource "COINGECKO".
- Common mappings: BTC=bitcoin, ETH=ethereum, SOL=solana, BNB=binancecoin, XRP=ripple, ADA=cardano, DOGE=dogecoin, AVAX=avalanche-2, LINK=chainlink, LTC=litecoin.
- CoinGecko uses lowercase IDs (e.g., "bitcoin" not "BTC"). The tool auto-resolves common tickers.
- For general crypto questions, check top coins (bitcoin, ethereum, solana) to give market context.

Structure responses clearly (headings, tables, lists) when presenting complex data. If data is partial or confidence is low, add uncertainty language and suggest consulting a professional.`;

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
    conversationId,
    message
  }: {
    conversationHistory?: AiAgentMessage[];
    conversationId?: string;
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

    // Load context from DB if conversationId provided, else fall back to client history
    let contextHistory = conversationHistory;

    if (conversationId) {
      const conversation = await this.getConversation(
        conversationId,
        userId
      );

      if (conversation?.messages?.length) {
        contextHistory = conversation.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.createdAt.toISOString()
        }));
      }
    }

    const messages = [
      ...contextHistory.slice(-MAX_CONTEXT_MESSAGES).map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user' as const, content: message }
    ];

    const toolCallsLog: AiAgentToolCall[] = [];

    const tools = {
      portfolio_summary: tool({
        description:
          'Get a comprehensive summary of the user\'s investment portfolio including holdings, allocation percentages, asset classes, current values, overall performance metrics, daily P&L (today\'s gains/losses), and per-holding daily price changes. Use this when the user asks about their portfolio overview, holdings, allocation, today\'s performance, or daily gains/losses.',
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
                userCurrency,
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
          'Get current market prices, daily price changes (vs previous close), currency, and market state for specific symbols. Supports stocks (YAHOO) and cryptocurrencies (COINGECKO). Common crypto tickers (BTC, ETH, SOL, etc.) are auto-resolved to CoinGecko IDs. Use this when the user asks about current prices, today\'s price changes, intraday movement, market conditions, crypto prices, or wants to compare holdings to market data.',
        parameters: z.object({
          symbols: z
            .array(
              z.object({
                symbol: z
                  .string()
                  .describe(
                    'The ticker symbol (e.g., AAPL for stocks, bitcoin or BTC for crypto)'
                  ),
                dataSource: z
                  .string()
                  .describe(
                    'Data source: YAHOO for stocks/ETFs, COINGECKO for crypto, MANUAL for custom'
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
      let llmTotalMs = 0;

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

        const llmStartTime = performance.now();
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
        llmTotalMs = Math.round(performance.now() - llmStartTime);

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
      const toolErrors = toolCallsLog.filter(
        (tc) => (tc.result as any)?.error
      ).length;
      const confidence = this.verificationService.assessConfidence({
        toolCallCount: toolCallsLog.length,
        hasErrors: hasVerificationErrors,
        responseLength: responseText.length,
        hallucinationScore: lastHallucinationScore,
        toolErrors,
        dataAgeMinutes: this.computeDataAge(toolCallsLog)
      });

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

      // Compute LLM latency by subtracting tool execution time
      const totalToolMs = toolCallsLog.reduce(
        (sum, t) => sum + (t.durationMs ?? 0),
        0
      );
      const llmLatencyMs = Math.max(0, llmTotalMs - totalToolMs);

      // Report LLM latency to Langfuse
      this.telemetryService.reportLangfuseScore({
        traceId,
        name: 'llm-latency-ms',
        value: llmLatencyMs,
        comment: `LLM: ${llmLatencyMs}ms, Tools: ${totalToolMs}ms, Total: ${llmTotalMs}ms`
      });

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
        llmLatencyMs,
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
        disclaimers: this.verificationService.getContextualDisclaimers(
          toolCallsLog.map((t) => t.toolName)
        ),
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
    conversationId,
    message
  }: {
    conversationHistory?: AiAgentMessage[];
    conversationId?: string;
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

    // Load context from DB if conversationId provided, else fall back to client history
    let contextHistory = conversationHistory;

    if (conversationId) {
      const conversation = await this.getConversation(
        conversationId,
        userId
      );

      if (conversation?.messages?.length) {
        contextHistory = conversation.messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: m.createdAt.toISOString()
        }));
      }
    }

    // Ensure we have a conversation to persist to
    let activeConversationId = conversationId;

    if (!activeConversationId) {
      const conv =
        await this.getOrCreateActiveConversation(userId);
      activeConversationId = conv.id;
    }

    const messages = [
      ...contextHistory.slice(-MAX_CONTEXT_MESSAGES).map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      })),
      { role: 'user' as const, content: message }
    ];

    const toolCallsLog: AiAgentToolCall[] = [];

    interface StreamMeta {
      toolCalls: AiAgentToolCall[];
      confidence: number;
      disclaimers: string[];
    }

    let resolveStreamMeta: (meta: StreamMeta) => void;
    const streamMetaPromise = new Promise<StreamMeta>((resolve) => {
      resolveStreamMeta = resolve;
    });

    const tools = {
      portfolio_summary: tool({
        description:
          'Get a comprehensive summary of the user\'s investment portfolio including holdings, allocation percentages, asset classes, current values, overall performance metrics, daily P&L (today\'s gains/losses), and per-holding daily price changes. Use this when the user asks about their portfolio overview, holdings, allocation, today\'s performance, or daily gains/losses.',
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
                userCurrency,
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
          'Get current market prices, daily price changes (vs previous close), currency, and market state for specific symbols. Supports stocks (YAHOO) and cryptocurrencies (COINGECKO). Common crypto tickers (BTC, ETH, SOL, etc.) are auto-resolved to CoinGecko IDs. Use this when the user asks about current prices, today\'s price changes, intraday movement, market conditions, crypto prices, or wants to compare holdings to market data.',
        parameters: z.object({
          symbols: z
            .array(
              z.object({
                symbol: z
                  .string()
                  .describe(
                    'The ticker symbol (e.g., AAPL for stocks, bitcoin or BTC for crypto)'
                  ),
                dataSource: z
                  .string()
                  .describe(
                    'Data source: YAHOO for stocks/ETFs, COINGECKO for crypto, MANUAL for custom'
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

    const streamLlmStartTime = performance.now();
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
        let lastHallucinationScore: number | undefined;
        const streamTotalMs = Math.round(
          performance.now() - streamLlmStartTime
        );

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

          const toolErrors = toolCallsLog.filter(
            (tc) => (tc.result as any)?.error
          ).length;
          const confidence =
            this.verificationService.assessConfidence({
              toolCallCount: toolCallsLog.length,
              hasErrors: false,
              responseLength: responseText.length,
              hallucinationScore: lastHallucinationScore,
              toolErrors,
              dataAgeMinutes: this.computeDataAge(toolCallsLog)
            });

          this.telemetryService.reportLangfuseScores({
            traceId,
            confidence,
            hallucinationScore: lastHallucinationScore,
            toolCallCount: toolCallsLog.length
          });

          // Compute LLM latency by subtracting tool execution time
          const streamToolMs = toolCallsLog.reduce(
            (sum, t) => sum + (t.durationMs ?? 0),
            0
          );
          const streamLlmLatencyMs = Math.max(
            0,
            streamTotalMs - streamToolMs
          );

          this.telemetryService.reportLangfuseScore({
            traceId,
            name: 'llm-latency-ms',
            value: streamLlmLatencyMs,
            comment: `LLM: ${streamLlmLatencyMs}ms, Tools: ${streamToolMs}ms, Total: ${streamTotalMs}ms`
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
            llmLatencyMs: streamLlmLatencyMs,
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

          // Persist user + assistant messages to conversation
          if (activeConversationId && text) {
            await this.appendMessages({
              conversationId: activeConversationId,
              userContent: message,
              assistantContent: text,
              traceId
            });
          }
        } catch (err) {
          this.logger.warn(
            `[${traceId}] Stream onFinish telemetry failed: ${err.message}`
          );
        } finally {
          const finalConfidence =
            this.verificationService.assessConfidence({
              toolCallCount: toolCallsLog.length,
              hasErrors: false,
              responseLength: text?.length ?? 0,
              hallucinationScore: lastHallucinationScore,
              toolErrors: toolCallsLog.filter(
                (tc) => (tc.result as any)?.error
              ).length,
              dataAgeMinutes: this.computeDataAge(toolCallsLog)
            });
          resolveStreamMeta({
            toolCalls: toolCallsLog,
            confidence: finalConfidence,
            disclaimers:
              this.verificationService.getContextualDisclaimers(
                toolCallsLog.map((t) => t.toolName)
              )
          });
        }
      }
    });

    return {
      result,
      traceId,
      streamMetaPromise,
      conversationId: activeConversationId
    };
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

  public async getOrCreateActiveConversation(userId: string) {
    const existing =
      await this.prismaService.aiAgentConversation.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' }
          }
        }
      });

    if (existing) {
      return existing;
    }

    return this.prismaService.aiAgentConversation.create({
      data: { userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
  }

  public async getConversation(conversationId: string, userId: string) {
    return this.prismaService.aiAgentConversation.findFirst({
      where: { id: conversationId, userId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
  }

  public async createConversation(userId: string, title?: string) {
    return this.prismaService.aiAgentConversation.create({
      data: { userId, title },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
  }

  public async appendMessages({
    conversationId,
    userContent,
    assistantContent,
    traceId
  }: {
    conversationId: string;
    userContent: string;
    assistantContent?: string;
    traceId?: string;
  }) {
    const data = [
      {
        conversationId,
        role: 'user',
        content: userContent
      }
    ];

    if (assistantContent) {
      data.push({
        conversationId,
        role: 'assistant',
        content: assistantContent,
        ...(traceId ? { traceId } : {})
      } as any);
    }

    await this.prismaService.aiAgentConversationMessage.createMany({
      data
    });

    await this.prismaService.aiAgentConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });
  }

  private computeDataAge(
    toolCallsLog: AiAgentToolCall[]
  ): number | undefined {
    const marketCall = toolCallsLog.find(
      (tc) => tc.toolName === 'market_context'
    );

    if (!marketCall?.result || (marketCall.result as any)?.error) {
      return undefined;
    }

    const result = marketCall.result as any;
    const timestamp =
      result?.timestamp ?? result?.fetchedAt ?? result?.date;

    if (!timestamp) {
      return undefined;
    }

    const fetchedAt = new Date(timestamp);

    if (isNaN(fetchedAt.getTime())) {
      return undefined;
    }

    return (Date.now() - fetchedAt.getTime()) / 60_000;
  }
}
