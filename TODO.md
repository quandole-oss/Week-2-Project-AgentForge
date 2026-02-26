# AgentForge: AI Agent for Ghostfolio — TODO

## Phase 1: Foundation — Single Tool End-to-End
- [x] Install `@ai-sdk/anthropic` dependency
- [x] Add `ENABLE_FEATURE_AI_AGENT` feature flag (environment interface + configuration service)
- [x] Add `accessAiAgent` permission (permissions.ts + ADMIN/USER role arrays)
- [x] Add `PROPERTY_API_KEY_ANTHROPIC` config key (config.ts)
- [x] Create shared interfaces (`AiAgentResponse`, `AiAgentMessage`)
- [x] Export from interfaces barrel (`libs/common/src/lib/interfaces/index.ts`)
- [x] Create `AiAgentModule` (module, controller, service, DTO)
- [x] Create `portfolio-summary.tool.ts` (first tool)
- [x] Create `verification.service.ts` (V1 — disclaimer enforcement)
- [x] Register `AiAgentModule` in `AppModule`
- [x] Verify TypeScript compiles

## Phase 2: Tool Expansion
- [x] `transaction_analyzer` tool (OrderService.getOrders)
- [x] `market_context` tool (DataProviderService.getQuotes)
- [x] `tax_estimator` tool (FIFO lot logic)
- [x] `compliance_checker` tool (PortfolioService.getDetails)
- [x] `allocation_optimizer` tool (target allocation drift)

## Phase 3: Multi-step Reasoning
- [x] Enhanced system prompt with reasoning instructions
- [x] Multi-tool query chaining verified via `maxSteps: 5`

## Phase 4: Observability
- [x] Structured logging in `ai-agent.service.ts`
- [x] Telemetry service (traceId, duration, tools, tokens)

## Phase 5: Eval Framework
- [x] Test fixtures (77 eval cases)
- [x] Unit tests per tool (60 tests across 4 suites)
- [x] Integration tests (25 eval spec tests)
- [x] Adversarial tests (12 adversarial cases + validation tests)

## Phase 6: Verification Layer Enhancement
- [x] Numerical accuracy verifier
- [x] Hallucination detector
- [x] Confidence scoring

## Phase 7: Frontend — Angular Chat Component
- [x] Backend API method in `data.service.ts`
- [x] Chat component (standalone Angular)
- [x] Page + routing (`/ai-agent`)

## Phase 8: Open Source Prep
- [x] Architecture documentation (`docs/ai-agent.md`)
- [x] CHANGELOG entry

## Phase 9: Langfuse Observability Integration
- [x] Add Langfuse SDK dependencies (`langfuse`, `langfuse-langchain`)
- [x] Create `TelemetryService` with Langfuse client initialization
- [x] Create `EvalPersistenceService` for eval result storage
- [x] Add OpenTelemetry instrumentation (`instrumentation.ts`)
- [x] Wire `experimental_telemetry` into AI SDK `streamText` calls
- [x] Add `onFinish` callback with `langfuse.flush()` for streaming traces
- [x] Add `AiAgentFeedback` model to Prisma schema
- [x] Create database migration (`20260224032126_add_ai_agent_observability`)
- [x] Add feedback DTO and endpoint
- [x] Configure Langfuse API keys on Railway (fix 401 Unauthorized)
- [x] Verify traces appear in Langfuse dashboard

## Phase 10: Deployment & Dev Experience
- [x] Add deployment guide to `DEVELOPMENT.md` (Docker Compose + Railway)
- [x] Add `fix-client-path` script for quoted folder name workaround
- [x] Add `CLAUDE.md` project instructions
- [x] Add Langfuse env placeholders to `.env.dev`

## Phase 11: Conversation Persistence (Memory System)
- [x] Add `AiAgentConversation` and `AiAgentConversationMessage` Prisma models
- [x] Add relation `aiAgentConversations` to `User` model
- [x] Create database migration (`20260224200000_add_ai_agent_conversation_persistence`)
- [x] Add `getOrCreateActiveConversation()`, `getConversation()`, `createConversation()`, `appendMessages()` service methods
- [x] Persist user + assistant messages in `chatStream` `onFinish` callback
- [x] Add `GET /ai-agent/conversation` endpoint (get or create active conversation)
- [x] Add `POST /ai-agent/conversation` endpoint (create new conversation)
- [x] Add optional `conversationId` to `AiAgentChatDto`
- [x] Return `X-Conversation-Id` header from stream endpoint
- [x] Replace hardcoded `slice(-10)` with configurable `AI_AGENT_MAX_CONTEXT_MESSAGES` (default 20)
- [x] Load context from DB when `conversationId` provided, fall back to client history
- [x] Frontend: load conversation on page init via `GET /ai-agent/conversation`
- [x] Frontend: send `conversationId` with stream requests
- [x] Frontend: "New Conversation" button
- [x] Frontend: loading state while fetching conversation
- [x] Remove debug logging snippet from `data.service.ts`
- [x] Add `AI_AGENT_MAX_CONTEXT_MESSAGES` to `.env.dev`

## Phase 12: Intraday Price Changes, Daily P&L, and Real-Time Portfolio Value
- [x] Create `previous-close.helper.ts` shared helper (MarketData lookback up to 5 days)
- [x] Enhance `MarketContextTool` with `previousClose`, `priceChange`, `priceChangePercent`
- [x] Enhance `PortfolioSummaryTool` with per-holding daily changes and portfolio-level `dailyChange`
- [x] Inject `MarketDataService` + `ExchangeRateDataService` into tools
- [x] Update `AiAgentService` tool descriptions to mention daily/intraday data
- [x] Pass `userCurrency` to `PortfolioSummaryTool.execute()`
- [x] Add 8 intraday eval cases (`eval-cases.ts`)
- [x] Add intraday validation tests (`ai-agent.eval.spec.ts`)

## Phase 13: Tool Transparency, Contextual Disclaimers, and High-Signal Confidence
- [x] Replace `toolNamesPromise` with `streamMetaPromise` carrying full `{ toolCalls, confidence, disclaimers }` in `chatStream()`
- [x] Change stream format from `__TOOLS__` to `__META__` with backward-compat fallback in frontend
- [x] Streaming expansion panel now shows full tool args and results (not just names)
- [x] Add `CONTEXTUAL_DISCLAIMERS` map (6 tool-specific disclaimers) to `VerificationService`
- [x] Add `getContextualDisclaimers()` method; include `disclaimers` in both `chat()` and `chatStream()` responses
- [x] Add `disclaimers?: string[]` to `AiAgentResponse` interface
- [x] Frontend renders contextual disclaimers with amber left-border styling
- [x] Refactor `assessConfidence()` from positional args to object params with 6 signals (base 0.95)
- [x] Integrate hallucination score, tool errors, and data staleness into confidence formula
- [x] Add `computeDataAge()` private method to extract market data freshness
- [x] Frontend shows color-coded confidence indicator (green/orange/red) with labels
- [x] Update verification service tests (13 assessConfidence + 6 getContextualDisclaimers tests)
- [x] Update eval spec for new `assessConfidence()` signature
