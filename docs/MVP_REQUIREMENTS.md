# MVP Requirements — Pass Evidence

## Domain: Financial Portfolio Analysis (Wealth Management)

| # | Requirement | Status | Evidence |
|---|-------------|--------|----------|
| 1 | Agent responds to natural language queries | PASS | See below |
| 2 | At least 3 functional tools | PASS | 6 tools implemented |
| 3 | Tool calls execute and return structured results | PASS | See below |
| 4 | Agent synthesizes tool results into coherent responses | PASS | See below |
| 5 | Conversation history maintained across turns | PASS | See below |
| 6 | Basic error handling (graceful failure) | PASS | See below |
| 7 | At least one domain-specific verification check | PASS | 5 checks implemented |
| 8 | 5+ test cases with expected outcomes | PASS | 69 eval cases, 25 integration tests |
| 9 | Deployed and publicly accessible | PASS | Railway deployment live |

---

### 1. Agent responds to natural language queries in your chosen domain

**Domain:** Financial portfolio analysis — users ask questions about holdings, transactions, taxes, compliance, allocation, and market data in plain English.

**Implementation:** `apps/api/src/app/endpoints/ai-agent/ai-agent.service.ts`

- Uses Claude Haiku 3.5 (`claude-haiku-4-5-20251001`) via `@ai-sdk/anthropic`
- System prompt (line 40) defines the agent as a "read-only financial portfolio assistant for Ghostfolio"
- Accepts free-form `message` string from the user
- Supports both synchronous (`POST /ai-agent/chat`) and streaming (`POST /ai-agent/chat/stream`) responses
- Responses are rendered as formatted markdown in the Angular frontend

**Example queries the agent handles:**
- "What's my portfolio allocation?"
- "Show me my transaction history for 2025"
- "Estimate my capital gains taxes"
- "Check my portfolio for compliance issues"
- "How should I rebalance to 60/30/10?"

---

### 2. At least 3 functional tools the agent can invoke

**6 tools implemented** in `apps/api/src/app/endpoints/ai-agent/`:

| Tool | File | What it does |
|------|------|-------------|
| `portfolio_summary` | `tools/portfolio-summary.tool.ts` | Holdings, allocation %, asset classes, current values, performance metrics |
| `transaction_analyzer` | `tools/transaction-analyzer.tool.ts` | Activity counts by type/month, total fees, date ranges |
| `market_context` | `tools/market-context.tool.ts` | Current market prices, currency, market state for symbols |
| `tax_estimator` | `tools/tax-estimator.tool.ts` | Capital gains estimation using FIFO lot matching |
| `compliance_checker` | `tools/compliance-checker.tool.ts` | Concentration risk, diversification, currency exposure checks |
| `allocation_optimizer` | `tools/allocation-optimizer.tool.ts` | Compare current vs target allocation, suggest rebalancing |

Each tool is registered with Zod parameter schemas and descriptions so the LLM can select them autonomously. Multi-tool chaining is supported via `maxSteps: 3`.

---

### 3. Tool calls execute successfully and return structured results

**Implementation:** Each tool's `execute()` method returns structured JSON. Results are logged in `toolCallsLog` with timing data.

**Example structured result (portfolio_summary):**
```json
{
  "holdings": [...],
  "totalValue": 125000.50,
  "allocationByAssetClass": { "EQUITY": 0.65, "FIXED_INCOME": 0.25, "LIQUIDITY": 0.10 },
  "performancePercentage": 12.5
}
```

**Evidence of execution tracking** (`ai-agent.service.ts`):
- Every tool call is wrapped in try/catch with duration measurement
- `toolCallsLog` captures: `toolName`, `args`, `result`, `durationMs`
- Tool names are sent back to the client via `__TOOLS__:` suffix in the stream
- Tool results are displayed in an expandable panel in the frontend UI

---

### 4. Agent synthesizes tool results into coherent responses

**Implementation:** Claude Haiku receives tool results and generates natural-language responses with:

- **Markdown formatting** — headings, tables, lists, bold/italic for structured data presentation
- **Verification layer** — responses pass through `VerificationService.enforceDisclaimer()` to ensure disclaimers
- **Hallucination detection** — `HallucinationDetector.check()` verifies numerical claims against tool data
- **Confidence scoring** — `VerificationService.assessConfidence()` rates response reliability (0–1)
- **Low-confidence language** — when confidence < 0.7, uncertainty language is automatically appended
- **Retry on hallucination** — if hallucination score > 0.1, the model regenerates (up to 1 retry)

The frontend renders responses as HTML via `marked` markdown parser with dark-mode-aware styling.

---

### 5. Conversation history maintained across turns

**Implementation:** Full server-side persistence via PostgreSQL.

**Database models** (`prisma/schema.prisma`):
- `AiAgentConversation` — `id`, `userId`, `title`, `createdAt`, `updatedAt`
- `AiAgentConversationMessage` — `id`, `conversationId`, `role`, `content`, `traceId`, `createdAt`
- Cascade delete: deleting a user removes all their conversations and messages

**API endpoints:**
- `GET /api/v1/ai-agent/conversation` — loads active conversation (or creates one)
- `POST /api/v1/ai-agent/conversation` — creates a new conversation
- `POST /api/v1/ai-agent/chat/stream` — accepts optional `conversationId`; returns `X-Conversation-Id` header

**How it works:**
1. On page load, the frontend calls `GET /conversation` to load the most recent conversation
2. Previous messages are displayed (re-rendered as markdown)
3. Each stream request sends `conversationId`; server loads the last 20 messages from DB as context
4. On stream completion (`onFinish`), both the user message and assistant response are persisted to the conversation
5. "New Conversation" button creates a fresh conversation

**Context window:** Configurable via `AI_AGENT_MAX_CONTEXT_MESSAGES` (default: 20 messages).

---

### 6. Basic error handling (graceful failure, not crashes)

**7 error handling patterns** in `ai-agent.service.ts`:

| Pattern | Behavior | HTTP Status |
|---------|----------|-------------|
| Feature flag disabled | Returns clear error message | 403 Forbidden |
| API key not configured | Returns service unavailable message | 503 Service Unavailable |
| Daily cost cap exceeded ($5/day) | Returns rate limit message | 429 Too Many Requests |
| Tool execution failure | Returns `{ error: true, message }` — agent continues with remaining tools | N/A (handled internally) |
| Request timeout (25s sync / 30s stream) | Returns timeout message | 504 Gateway Timeout |
| Verification failure | Retries once, then serves response with warning | 200 (with caveat) |
| Unexpected error | Logs structured error with stack trace, returns generic message | 500 Internal Server Error |

**Additional resilience:**
- `AbortSignal.timeout()` prevents hanging requests
- Error categorization via `TelemetryService.categorizeError()` for structured logging
- Tool errors don't crash the request — the agent acknowledges the limitation and continues
- Frontend shows a user-friendly error message on failure

---

### 7. At least one domain-specific verification check

**5 domain-specific checks** implemented across two services:

**`verification/verification.service.ts`:**

1. **Financial Disclaimer Enforcement** — ensures every response contains "educational purposes only / not financial advice" language. Appends it if missing.
2. **Source Attribution Validation** — checks that tool results are referenced in the response text; flags tools with missing attribution.
3. **Numerical Accuracy Verification** — extracts dollar amounts and percentages from the response, compares against tool data with 0.01% tolerance, flags drift.
4. **Confidence Assessment** — scores response reliability (0–1) based on tool call count, error presence, and response length.

**`verification/hallucination-detector.ts`:**

5. **Hallucination Detection** — extracts factual claims containing numbers, verifies each against tool results using exact match, string inclusion, and rounding tolerance. Returns a hallucination score (0–1). Triggers regeneration if score > 0.1, adds a warning if > 0.05.

---

### 8. Simple evaluation: 5+ test cases with expected outcomes

**69 eval cases** in `__tests__/eval-cases.ts` across 8 categories:

| Category | Count | Example |
|----------|-------|---------|
| Portfolio | 10 | "What's my portfolio overview?" → expects `portfolio_summary` tool |
| Transactions | 10 | "Show my recent transactions" → expects `transaction_analyzer` tool |
| Market | 8 | "What's the current price of AAPL?" → expects `market_context` tool |
| Tax | 8 | "Estimate my 2024 capital gains" → expects `tax_estimator` tool |
| Compliance | 8 | "Check concentration risk" → expects `compliance_checker` tool |
| Allocation | 8 | "How should I rebalance?" → expects `allocation_optimizer` tool |
| Multi-tool | 10 | Complex queries requiring multiple tools |
| Adversarial | 12 | Prompt injection attempts, off-topic queries (all expect 0 tool calls) |

**Each test case defines:**
```typescript
{
  id: string;
  input: string;              // The natural language query
  expectedTools: string[];    // Which tools should be invoked
  assertions: {
    hasDisclaimer: boolean;   // Must include financial disclaimer
    minToolCalls: number;     // Minimum expected tool invocations
    maxToolCalls: number;     // Maximum expected tool invocations
  };
  category: string;
}
```

**25 integration tests** in `ai-agent.eval.spec.ts` validate:
- Verification service behavior (7 tests)
- Hallucination detection (5 tests)
- Eval case structure and coverage (7 tests)
- Adversarial input handling (4 tests + 2 additional)

---

### 9. Deployed and publicly accessible

**Live URL:** https://ghostfolio-production-64f6.up.railway.app

**Platform:** Railway (Docker-based deployment)

**Infrastructure:**
- **API + Client:** NestJS backend serving the Angular SPA (port 3333)
- **Database:** PostgreSQL (Railway managed)
- **Cache/Queue:** Redis (Railway managed)
- **Observability:** Langfuse (us.cloud.langfuse.com) for trace collection

**Environment variables configured on Railway:**
- `ENABLE_FEATURE_AI_AGENT=true`
- `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_BASEURL`
- Anthropic API key (stored in DB via `PROPERTY_API_KEY_ANTHROPIC`)
- PostgreSQL, Redis, JWT credentials

**Deployment flow:** Push to `main` → Railway auto-builds Docker image → runs migrations → serves app.
