# AgentForge: AI Agent for Ghostfolio

## Overview

AgentForge is an AI-powered financial portfolio assistant built inside Ghostfolio. It answers natural language questions about portfolio holdings, transactions, taxes, compliance, and market data by calling Ghostfolio's existing services directly via NestJS dependency injection.

**Key properties:**
- **Read-only**: Never executes trades or modifies portfolio data
- **Verified**: Includes disclaimer enforcement, numerical accuracy checks, and hallucination detection
- **Grounded**: Only references data returned by tools — never fabricates numbers

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Angular Frontend                   │
│              /ai-agent chat component                │
│    ┌──────────────────────────────────────────┐     │
│    │  GfAiAgentPageComponent                  │     │
│    │  - Message list with markdown rendering  │     │
│    │  - Collapsible tool call details (full)   │     │
│    │  - Contextual + static disclaimers       │     │
│    │  - Color-coded confidence indicator      │     │
│    │  - Conversation history management       │     │
│    └──────────────────────────────────────────┘     │
└─────────────────────┬───────────────────────────────┘
                      │ POST /api/v1/ai-agent/chat
                      ▼
┌─────────────────────────────────────────────────────┐
│                  NestJS Backend                      │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  AiAgentController                           │   │
│  │  - JWT + HasPermissionGuard                  │   │
│  │  - Feature flag check                        │   │
│  └──────────────┬───────────────────────────────┘   │
│                 │                                     │
│  ┌──────────────▼───────────────────────────────┐   │
│  │  AiAgentService (orchestrator)               │   │
│  │  - Vercel AI SDK generateText()              │   │
│  │  - Anthropic Claude provider                 │   │
│  │  - Tool registration + execution             │   │
│  │  - maxSteps: 5 for multi-tool chaining       │   │
│  └──────────────┬───────────────────────────────┘   │
│                 │                                     │
│  ┌──────────────▼───────────────────────────────┐   │
│  │  Tools (6 total)                             │   │
│  │  ┌─────────────────┐ ┌────────────────────┐  │   │
│  │  │portfolio_summary│ │transaction_analyzer│  │   │
│  │  └────────┬────────┘ └────────┬───────────┘  │   │
│  │  ┌────────┴────────┐ ┌────────┴───────────┐  │   │
│  │  │ market_context  │ │  tax_estimator     │  │   │
│  │  └────────┬────────┘ └────────┬───────────┘  │   │
│  │  ┌────────┴────────┐ ┌────────┴───────────┐  │   │
│  │  │compliance_check │ │allocation_optimizer│  │   │
│  │  └─────────────────┘ └────────────────────┘  │   │
│  └──────────────────────────────────────────────┘   │
│                 │                                     │
│  ┌──────────────▼───────────────────────────────┐   │
│  │  Ghostfolio Services (injected via DI)       │   │
│  │  - PortfolioService.getDetails()             │   │
│  │  - OrderService.getOrders()                  │   │
│  │  - DataProviderService.getQuotes()           │   │
│  │  - PropertyService.getByKey()                │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Verification Layer                          │   │
│  │  - Disclaimer enforcement (regex + inject)   │   │
│  │  - Contextual disclaimers (per-tool)         │   │
│  │  - Numerical accuracy verification           │   │
│  │  - Hallucination detection                   │   │
│  │  - Multi-signal confidence scoring (0-1)     │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  Telemetry                                   │   │
│  │  - Structured JSON logs                      │   │
│  │  - Trace IDs, duration, tool calls, tokens   │   │
│  │  - LLM vs tool latency isolation             │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

## Setup

### 1. Enable the feature flag

Set in your environment:
```
ENABLE_FEATURE_AI_AGENT=true
```

### 2. Configure Anthropic API key

Store the API key via Ghostfolio's PropertyService (admin DB insert):
```sql
INSERT INTO "Property" (key, value) VALUES ('API_KEY_ANTHROPIC', '"sk-ant-your-key-here"');
```

### 3. Verify

```bash
curl -X POST http://localhost:3333/api/v1/ai-agent/chat \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "What does my portfolio look like?"}'
```

## Tools

| Tool | Description | Ghostfolio Service |
|------|-------------|-------------------|
| `portfolio_summary` | Holdings, allocation, performance, summary stats | `PortfolioService.getDetails()` |
| `transaction_analyzer` | Activity counts by type/month, fees, date ranges | `OrderService.getOrders()` |
| `market_context` | Current prices, currency, market state | `DataProviderService.getQuotes()` |
| `tax_estimator` | FIFO capital gains estimation | `OrderService.getOrders()` + FIFO logic |
| `compliance_checker` | Concentration, diversification, currency checks | `PortfolioService.getDetails()` |
| `allocation_optimizer` | Target allocation drift, rebalance suggestions | `PortfolioService.getDetails()` |

## Verification Layer

1. **Disclaimer Enforcement**: Every response is checked for financial advice disclaimer via regex. If missing, it's auto-injected.

2. **Contextual Disclaimers**: Each tool maps to a domain-specific disclaimer (e.g., tax estimates mention FIFO simplification, market prices note potential 15-minute delay). Applicable disclaimers are selected per response based on which tools were called.

3. **Numerical Accuracy**: Numbers in LLM response are extracted and compared against tool result numbers with configurable tolerance (default 0.01%).

4. **Hallucination Detection**: Factual claims (sentences with numbers) are cross-referenced against tool outputs. Score > 3% triggers warning, > 5% triggers regeneration (aligned with < 5% hallucination rate target).

5. **Confidence Scoring**: 0-1 score based on 6 signals: tool call count, verification errors, response length, hallucination score, tool errors, and data staleness (market data age). Base confidence is 0.95 with granular penalties. Scores < 0.7 trigger uncertainty language. Frontend displays color-coded labels (green/orange/red).

6. **LLM Latency Isolation**: Pure LLM inference time is measured separately from tool execution time by timing `generateText()`/`streamText()` calls and subtracting tool durations. Reported as `llmLatencyMs` in telemetry and as `llm-latency-ms` score in Langfuse.

## Prompt design and verification plan

The system prompt is designed to work with the **current pipeline**: the model returns **plain markdown** only. The API does not expect or parse JSON from the assistant.

**Intent-aware behavior (in-prompt):** The model is instructed to classify user intent and respond accordingly:

| Intent | Description | Model behavior |
|--------|-------------|----------------|
| **DATA_RETRIEVAL** | Facts, balances, performance | Answer directly; no in-text disclaimer required (system injects). |
| **EDUCATION_ANALYSIS** | Explanations, risk, scenarios | Provide analysis; may add one line that the analysis is educational. |
| **ADVICE_PREDICTION** | Recommendations, predictions, “what should I do?” | Refuse; start with “I cannot provide personalized financial advice…” and pivot to an objective analysis (e.g. allocation, tax impact). |

**Disclaimer handling:** The backend always enforces disclaimers via `VerificationService.enforceDisclaimer()` (regex check + append if missing) and attaches contextual disclaimers per tool. The prompt tells the model when to use light vs strict *tone* (e.g. refuse + pivot for advice); the actual disclaimer text and per-tool caveats are applied server-side.

**UX directives in prompt:** Lead with insights when context exists; progressive disclosure (one strong analysis at a time for open-ended questions, multiple tools when the user asks for a full review); no capability menus.

Future work could introduce structured output (e.g. intent + suggested UI trigger) if the API and frontend are extended to parse and render it.

## Testing

```bash
# Run all AI agent tests
npx jest --config apps/api/jest.config.ts --testPathPatterns='ai-agent.*spec'
```

**Test coverage:**
- 59 unit tests (portfolio summary, transaction analyzer, compliance checker, verification service)
- 25 integration/eval tests (verification, hallucination detection, eval case validation)
- 69 eval cases (portfolio, transactions, market, tax, compliance, allocation, multi-tool, adversarial, edge-case)
- Performance target assertions (6 metrics: pass rate, hallucination rate, verification accuracy, tool success rate, single-tool latency, multi-step latency)

## File Structure

```
apps/api/src/app/endpoints/ai-agent/
├── ai-agent.module.ts          # NestJS module
├── ai-agent.controller.ts      # POST /ai-agent/chat endpoint
├── ai-agent.service.ts         # Core orchestrator (Vercel AI SDK + Anthropic)
├── dto/
│   └── ai-agent-chat.dto.ts    # Request validation
├── tools/
│   ├── portfolio-summary.tool.ts
│   ├── transaction-analyzer.tool.ts
│   ├── market-context.tool.ts
│   ├── tax-estimator.tool.ts
│   ├── compliance-checker.tool.ts
│   ├── allocation-optimizer.tool.ts
│   └── __tests__/
│       ├── portfolio-summary.tool.spec.ts
│       ├── transaction-analyzer.tool.spec.ts
│       ├── compliance-checker.tool.spec.ts
│       └── verification.service.spec.ts
├── verification/
│   ├── verification.service.ts
│   └── hallucination-detector.ts
├── telemetry/
│   └── telemetry.service.ts
└── __tests__/
    ├── eval-cases.ts               # 69 eval test cases
    ├── ai-agent.eval.spec.ts       # Integration tests
    └── performance-targets.spec.ts # Performance target assertions (6 metrics)

libs/common/src/lib/
├── config.ts                   # + PROPERTY_API_KEY_ANTHROPIC
├── permissions.ts              # + accessAiAgent permission
└── interfaces/
    └── responses/
        └── ai-agent-response.interface.ts

apps/client/src/app/pages/ai-agent/
└── ai-agent-page.component.ts  # Angular chat UI
```

## Security

- JWT authentication required
- Permission-based access control (`accessAiAgent`)
- Feature flag gating (`ENABLE_FEATURE_AI_AGENT`)
- Read-only operations only — no portfolio mutations
- User-scoped data access — no cross-user data leakage
- Adversarial test suite validates against prompt injection, buy/sell solicitation, cross-user requests, and write operations

## Dependencies

- `ai` (v4.3.16) — Vercel AI SDK (pre-existing)
- `@ai-sdk/anthropic` (v1.x) — Anthropic Claude provider (added)
