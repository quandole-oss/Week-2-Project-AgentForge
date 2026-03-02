# Pre-Search Document — AgentForge

Completed before writing code. Documents architectural decisions, constraints, and build progression.

---

## Phase 1: Define Your Constraints

### 1. Domain Selection

- **Domain:** Finance (Ghostfolio — open-source wealth management, AGPL-3.0)
- **Specific use cases:** Portfolio analysis, transaction history, tax estimation (FIFO capital gains), compliance/concentration risk checks, market data (stocks + crypto), allocation drift analysis
- **Verification requirements:** Numerical accuracy (financial data cannot be wrong), hallucination detection (LLM must not fabricate holdings or prices), disclaimer enforcement (cannot give financial advice), read-only access (no trade execution)
- **Data sources:** Ghostfolio's existing Prisma/PostgreSQL database, Yahoo Finance (stock quotes via `DataProviderService`), CoinGecko (crypto quotes via `DataProviderService`)

### 2. Scale & Performance

- **Expected query volume:** Low initially (single-user dev), designed for 100-1,000 concurrent users
- **Acceptable latency:** <5s for single-tool queries, <15s for multi-tool chains (codified as performance targets in Phase 15)
- **Concurrent user requirements:** Rate limited to 10 requests/min/user via NestJS `@Throttle({ ttl: 60_000, limit: 10 })`
- **Cost constraints:** $5/day hard cap (`DAILY_COST_CAP = 5.0`) using Haiku pricing ($0.80/1M input, $4.00/1M output). Per-query cost target: <$0.01

### 3. Reliability Requirements

- **Cost of a wrong answer:** High — incorrect gain/loss figures could lead to bad tax filings or poor investment decisions. Incorrect compliance data could give false sense of diversification.
- **Non-negotiable verification:** Numerical accuracy checks (every number in response must trace to tool data), hallucination detection (>5% ungrounded claims triggers regeneration, >3% triggers warning), financial advice disclaimer on every response
- **Human-in-the-loop:** Not implemented. Agent is read-only and always includes disclaimers directing users to consult professionals.
- **Audit/compliance:** Full Langfuse traces per request (4 scores: confidence, hallucination, tool-call-count, llm-latency-ms). Conversation history persisted in PostgreSQL (`AiAgentConversation` + `AiAgentConversationMessage` models). User feedback (thumbs up/down) linked to trace IDs.

### 4. Team & Skill Constraints

- **Agent frameworks:** Familiar with Vercel AI SDK from existing Ghostfolio dependency (`ai` v4.3.16 already in `package.json`). No prior LangChain/LangGraph experience.
- **Domain experience:** Familiar with portfolio management concepts, FIFO tax accounting, concentration risk analysis
- **Eval/testing:** Strong Jest experience (Ghostfolio already uses Jest with 4 parallel workers and `dotenv-cli`). No prior experience with LLM eval frameworks — built custom.

---

## Phase 2: Architecture Discovery

### 5. Agent Framework Selection

- **Decision:** Custom implementation on Vercel AI SDK (`ai` + `@ai-sdk/anthropic`)
- **Why not LangChain/LangGraph:** Ghostfolio is an Nx/NestJS monorepo. All services (PortfolioService, OrderService, DataProviderService) are available via dependency injection. LangChain would add an unnecessary abstraction layer between the agent and existing services with no benefit. The AI SDK was already a dependency — only `@ai-sdk/anthropic` needed to be added.
- **Single agent architecture:** One agent with 6 tools and multi-step chaining (`maxSteps: 3`, reduced from initial `maxSteps: 5` in Phase 3). No need for multi-agent — all tools operate on the same user's data within one request context.
- **State management:** Conversation history in PostgreSQL via Prisma (added Phase 11). `AiAgentConversation` and `AiAgentConversationMessage` models with configurable context window (`AI_AGENT_MAX_CONTEXT_MESSAGES`, default 20).
- **Tool integration:** Direct DI injection of Ghostfolio services into tool classes. No API calls or serialization boundaries — tools call the same TypeScript methods the dashboard uses.

### 6. LLM Selection

- **Decision:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- **Why Haiku over Sonnet/Opus:** 5-10x cheaper. Tool-calling tasks (select tool → parse result → format response) don't require deep reasoning. Haiku handles structured tool selection reliably.
- **Function calling:** Native support via Vercel AI SDK `createAnthropic()`. Zod schemas define tool parameters.
- **Context window:** 200K tokens. More than sufficient — typical request uses ~3,000-4,500 tokens.
- **Cost per query:** ~$0.005 average (well under $0.01 target)

### 7. Tool Design

Six tools, each a standalone NestJS `@Injectable()` class:

| Tool | Service | Added |
|------|---------|-------|
| `portfolio_summary` | `PortfolioService.getDetails()` | Phase 1 |
| `transaction_analyzer` | `OrderService.getOrders()` | Phase 2 |
| `market_context` | `DataProviderService.getQuotes()` | Phase 2 |
| `tax_estimator` | `OrderService.getOrders()` + custom FIFO | Phase 2 |
| `compliance_checker` | `PortfolioService.getDetails()` | Phase 2 |
| `allocation_optimizer` | `PortfolioService.getDetails()` | Phase 2 |

- **External API dependencies:** Yahoo Finance (stock quotes), CoinGecko (crypto quotes, with symbol resolver added Phase 16). Both already integrated in Ghostfolio's `DataProviderService`.
- **Mock vs real data:** Real data for all tools in production. Tests use Jest mocks on PortfolioService, OrderService, etc.
- **Error handling per tool:** Each tool wrapped in try/catch. Errors logged to telemetry with category classification (`api_error`, `timeout_error`, `tool_error`, `verification_error`, `validation_error`). Failed tools deduct 0.10 from confidence score. Agent continues with partial results when possible.

### 8. Observability Strategy

- **Decision:** Langfuse (open-source tracing)
- **Why not LangSmith/Braintrust:** Langfuse is open-source (aligns with Ghostfolio's AGPL license), self-hostable, and has a free cloud tier. LangSmith requires LangChain ecosystem. Braintrust is proprietary.
- **Implementation (Phase 9):**
  - `TelemetryService` wraps Langfuse client with trace/generation/score methods
  - `EvalPersistenceService` stores eval runs in `AiAgentEvalResult` Prisma table
  - `experimental_telemetry` wired into AI SDK `streamText()` calls
  - `onFinish` callback calls `langfuse.flush()` for streaming trace completeness
  - `AiAgentFeedback` Prisma model for user thumbs up/down
- **4 scores per request:** `confidence`, `hallucination`, `tool-call-count`, `llm-latency-ms`
- **LLM latency isolation (Phase 15):** Total `generateText()`/`streamText()` duration minus tool execution time = pure model thinking time. Distinguishes "Claude was slow" from "Yahoo Finance was slow."
- **Cost tracking:** Per-request `promptTokens * $0.0000008 + completionTokens * $0.000004`. Daily accumulator with hard cap.

### 9. Eval Approach

- **Eval dataset:** 82 test cases across 11 categories (portfolio, transactions, market, tax, compliance, allocation, multi-tool, adversarial, edge-case, intraday, crypto)
- **Evolution:** Started with 77 cases (Phase 5), added 8 intraday cases (Phase 12), added 5 crypto cases (Phase 16), total after deduplication: 82
- **Each case includes:** `id`, `input` (natural language query), `expectedTools`, `assertions` (hasDisclaimer, minToolCalls, maxToolCalls, containsDataReferences), `category`
- **6 performance targets (Phase 15):** Eval pass rate >80%, hallucination rate <5%, verification accuracy >90%, tool success rate >95%, single-tool latency <5s, multi-tool latency <15s
- **Regression detection:** `EvalPersistenceService.detectRegression()` queries last 5 runs, computes rolling average, warns if current run drops >5%
- **CI integration:** All performance targets run as part of `npm run test:api`

### 10. Verification Design

Five verification mechanisms, built incrementally:

| # | Mechanism | Added | Threshold |
|---|----------|-------|-----------|
| 1 | Disclaimer enforcement (regex + auto-inject) | Phase 1 | Every response |
| 2 | Numerical accuracy (extract + compare numbers) | Phase 6 | 0.01% tolerance |
| 3 | Hallucination detection (claim extraction + grounding) | Phase 6 | >5% regenerate, >3% warn |
| 4 | Confidence scoring (6-signal formula) | Phase 6, refined Phase 13+17 | Base 0.95, <0.7 triggers uncertainty |
| 5 | Contextual disclaimers (per-tool domain caveats) | Phase 13 | Per tool called |

- **Phase 17 fix:** Decimal-aware sentence splitting — `$115,851.63` and `37.09%` no longer split as separate sentences, which caused false-positive hallucination scores. Hallucination penalty capped at 0.15 to prevent residual false positives from dropping confidence below 0.7.

---

## Phase 3: Post-Stack Refinement

### 11. Failure Mode Analysis

- **Tool failures:** Caught per-tool. Agent responds with available data + "I was unable to retrieve [X]" message. Each failed tool deducts 0.10 from confidence.
- **Ambiguous queries:** System prompt classifies into 3 intents: `DATA_RETRIEVAL`, `EDUCATION_ANALYSIS`, `ADVICE_PREDICTION` (redesigned Phase 14). Off-topic queries get no tool calls and a redirect to financial topics.
- **Rate limiting:** 10 req/min/user via NestJS Throttler (controller-level). $5/day global cost cap (service-level). Both return HTTP 429.
- **Graceful degradation:** If Anthropic API key missing → 503. If daily cap hit → 429 with "try again tomorrow." If individual tools fail → agent continues with partial results and reduced confidence.

### 12. Security Considerations

- **Prompt injection prevention:** 12 adversarial eval cases test 5 attack types: prompt injection (3), trade execution (3), cross-user access (2), write operations (2), credential extraction (2). All assert zero tool calls + disclaimer present.
- **Data leakage risks:** All tool calls are user-scoped (`userId` from JWT). No cross-user data access possible at the service layer — tools receive `userId` and pass it to Ghostfolio services which enforce scoping.
- **API key management:** Anthropic key stored in Ghostfolio's `PropertyService` (`PROPERTY_API_KEY_ANTHROPIC` in PostgreSQL), not in environment variables. Retrieved at runtime via `PropertyService.getByKey()`.
- **Read-only enforcement:** Agent has no write tools. All 6 tools call read-only service methods (`getDetails()`, `getOrders()`, `getQuotes()`). No mutation endpoints exposed.
- **Audit logging:** Every request traced in Langfuse with full input/output. Conversation history persisted in PostgreSQL with timestamps and trace IDs.

### 13. Testing Strategy

**197 passing tests across 34 suites** (2 skipped — require DB/external services):

| Test Type | Files | Details |
|-----------|-------|---------|
| Tool unit tests | 6 spec files | Each tool tested with mocked services. Portfolio summary: field mapping, sorting. Tax estimator: FIFO lot matching, short/long-term classification. Compliance checker: threshold violations/warnings. Market context: symbol resolution (9 tests). |
| Verification tests | 2 spec files | Confidence scorer (13 tests): penalty stacking, boundary conditions, signal combinations. Hallucination detector (11 tests): decimal protection, percentage matching, grounding checks. |
| Eval validation | 1 spec file | Structural assertions on all 82 eval cases. Category consistency. Tool mapping correctness. |
| Performance targets | 1 spec file | 6 automated metric assertions against thresholds. |
| Telemetry tests | 2 spec files | TelemetryService and EvalPersistenceService. |

- **Adversarial coverage:** 12 cases across 5 attack categories. Every case asserts: `maxToolCalls === 0`, `hasDisclaimer === true`.
- **Regression testing:** `EvalPersistenceService` stores results per run. `detectRegression()` flags >5% drops vs rolling 5-run average.

### 14. Open Source Planning

- **Released:** Full agent implementation as part of Ghostfolio fork on GitHub (`quandole-oss/Week-2-Project-AgentForge`)
- **Includes:** 6 tools, verification layer, telemetry, 82 eval cases (public dataset), 197 tests, architecture docs
- **Licensing:** AGPL-3.0 (matching Ghostfolio's license)
- **Documentation:** `docs/ai-agent.md` (architecture, setup, tools, verification, testing), `CHANGELOG.md` (2 release entries), `TODO.md` (17 phases)

### 15. Deployment & Operations

- **Hosting:** Railway (PostgreSQL + Redis + NestJS app + Angular frontend)
- **CI/CD:** Railway auto-deploys from `main` branch on push
- **Live URL:** `https://ghostfolio-production-64f6.up.railway.app`
- **Monitoring:** Langfuse dashboard for trace inspection. Daily cost tracked in-process.
- **Feature flag:** `ENABLE_FEATURE_AI_AGENT` — allows instant disable without deployment
- **Rollback strategy:** Git revert + Railway auto-redeploy. Feature flag for emergency disable.
- **Dev environment:** Docker Compose for PostgreSQL + Redis (`docker/docker-compose.dev.yml`), `.env.dev` with Langfuse placeholders, `fix-client-path` script for quoted folder name workaround (Phase 10)

### 16. Iteration Planning

**17 phases, each test-driven:**

| Phase | Focus | Key Deliverable |
|-------|-------|----------------|
| 1 | Foundation | Single tool (portfolio_summary) end-to-end with controller, service, verification V1 |
| 2 | Tool expansion | 5 additional tools (transaction, market, tax, compliance, allocation) |
| 3 | Multi-step reasoning | `maxSteps: 5` for tool chaining, enhanced system prompt |
| 4 | Observability | Structured logging, telemetry service with trace IDs |
| 5 | Eval framework | 77 eval cases, 60 unit tests, 25 integration tests, 12 adversarial cases |
| 6 | Verification enhancement | Numerical accuracy, hallucination detection, confidence scoring |
| 7 | Frontend | Angular chat component at `/ai-agent` with markdown rendering |
| 8 | Open source prep | Architecture docs (`docs/ai-agent.md`), CHANGELOG |
| 9 | Langfuse integration | Langfuse SDK, `TelemetryService`, `EvalPersistenceService`, feedback endpoint, Prisma migration |
| 10 | Deployment | Railway deployment guide, `CLAUDE.md`, Langfuse env config |
| 11 | Conversation persistence | `AiAgentConversation`/`AiAgentConversationMessage` Prisma models, 20-message context, `X-Conversation-Id` header |
| 12 | Intraday pricing | Per-holding daily changes, portfolio `dailyChange`, `previous-close.helper.ts`, 8 intraday eval cases |
| 13 | Tool transparency | `__META__` streaming payload (full tool args/results/timing), contextual disclaimers (6 per-tool), confidence scoring refactored to 6 signals (base 0.95) |
| 14 | Prompt redesign | Intent classification (DATA_RETRIEVAL / EDUCATION_ANALYSIS / ADVICE_PREDICTION), progressive disclosure, no capability menus |
| 15 | Performance targets | 6 automated metric assertions, hallucination thresholds tightened (>0.05 regenerate, >0.03 warn), LLM latency isolation (`llmLatencyMs`) |
| 16 | Crypto symbol resolution | `CRYPTO_SYMBOL_MAP` (~20 tickers), `resolveSymbol()` helper, 5 crypto eval cases, 9 unit tests |
| 17 | False-positive fix | Decimal-aware sentence splitting, hallucination penalty capped at 0.15, test data updated |

- **User feedback loop:** Thumbs up/down endpoint linked to Langfuse traces. Enables filtering by satisfaction for targeted improvement.
- **Eval-driven iteration:** Phase 17 was directly triggered by eval failures — decimal dollar amounts in test data caused false-positive hallucination scores, discovered through the performance targets suite.
- **Feature prioritization:** Verification gaps drove priority (hallucination detection before conversation persistence, confidence scoring before UI polish).
