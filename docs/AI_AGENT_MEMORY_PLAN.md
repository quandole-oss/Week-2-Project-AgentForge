# AI Agent Memory System — Implementation Plan

## Current State

| Area | Current behavior | Gap |
|------|------------------|-----|
| **Conversation history** | Client builds `conversationHistory` from in-memory `this.messages` and sends it with every request. API uses `conversationHistory.slice(-10)`. | History is lost on refresh, new device, or new tab. No server-side record of the thread. |
| **Context management** | Only the last 10 messages (role + content) are sent; no token budget, no summarization, no session/thread concept. | Long conversations get truncated arbitrarily; no way to “continue” a previous session. |
| **State persistence** | None for conversations. `AiAgentFeedback` is persisted (traceId, rating, correction) but not the dialogue. | Users cannot resume or review past conversations. |

---

## Goals

1. **Conversation history** — Persist messages per user (and optionally per thread) so history survives refresh and device change.
2. **Context management** — Define a clear context window (message count and/or token budget), optional summarization for long threads, and a single “current thread” or multiple named threads.
3. **State persistence** — Store threads and messages in the database, and optionally cache recent state on the client (e.g. localStorage) for fast load.

---

## Phase 1: Persist conversation (single thread per user)

**Scope:** One active conversation per user. Load on page open, append each turn, no threads yet.

### 1.1 Backend: Schema and API

- **Prisma**
  - Add `AiAgentConversation` (e.g. `id`, `userId`, `title` optional, `createdAt`, `updatedAt`).
  - Add `AiAgentMessage` (e.g. `id`, `conversationId`, `role`, `content`, `traceId` optional, `createdAt`).
  - Relation: `User` → `AiAgentConversation[]`; `AiAgentConversation` → `AiAgentMessage[]`.
  - Indexes: `userId` on conversation; `conversationId` (and optionally `createdAt`) on message.
- **API**
  - **GET** ` /api/v1/ai-agent/conversation`  
    Returns the current user’s active conversation: id + messages (role, content, timestamp, traceId).  
    “Active” = most recent by `updatedAt`, or create one if none.
  - **POST** ` /api/v1/ai-agent/chat/stream` (existing)  
    Request body: optional `conversationId`; keep `message` and optional `conversationHistory` for backward compatibility.
  - **Stream handler (after assistant reply)**  
    Append user message and assistant message to the conversation in DB (create conversation if needed).  
    Options: (A) append inside stream `onFinish` (or equivalent) in the service, or (B) client sends a follow-up “append” request with the final assistant text and traceId. Prefer (A) so the server is the source of truth.
- **Service**
  - Add `getOrCreateActiveConversation(userId)`.
  - Add `appendMessages(conversationId, userContent, assistantContent?, traceId?)`.
  - In `chatStream` (and non-stream `chat` if still used): after a successful reply, call `appendMessages` for the user turn and the assistant turn. Use the existing `conversationHistory` from the request only for in-call context; persistence is done from the service after the model responds.

### 1.2 Backend: Context window

- When loading conversation for a request, fetch last N messages (e.g. 20) or last N tokens (if you add token counting). Pass that as `conversationHistory` into the existing `chat`/`chatStream` logic.
- Keep existing `slice(-10)` or replace with a configurable limit (e.g. 20 messages or a token cap) so context stays bounded.

### 1.3 Client

- **On AI Agent page init:** Call GET `/api/v1/ai-agent/conversation`. If the response has messages, replace `this.messages` with the loaded list (map to `ChatMessage`, preserve `contentHtml` by re-running markdown on content).
- **After each successful assistant reply:** Either do nothing (server already persisted) or call a lightweight “sync” endpoint if you prefer client-triggered writes. Prefer server-side append only to avoid duplicates.
- **Optional:** Show a loading state while fetching conversation; show empty state if no conversation yet.

### 1.4 Migration and rollout

- Add Prisma migration for `AiAgentConversation` and `AiAgentMessage`.
- Deploy API first (new GET, updated stream handler with append). Then deploy client (fetch on init, optional “new conversation” button that clears local state and relies on next GET to return/create a new one).

---

## Phase 2: Context management (window + optional summary)

**Scope:** Explicit context limits and, if needed, summarization for long threads.

### 2.1 Context window (message and token limits)

- **Config**
  - Env or config: `AI_AGENT_MAX_CONTEXT_MESSAGES` (e.g. 20) and optionally `AI_AGENT_MAX_CONTEXT_TOKENS` (e.g. 8k).
- **Service**
  - When building `messages` for the model, take the last `AI_AGENT_MAX_CONTEXT_MESSAGES` from the persisted conversation (or from the request’s `conversationHistory` if you still allow override).
  - If using a token limit: add a small tokenizer or character-based estimate, trim from the oldest messages until within budget.
- **Docs**
  - Document in DEVELOPMENT.md or CLAUDE.md so future changes respect the same limits.

### 2.2 Optional: Summarization for long conversations

- When the conversation exceeds a threshold (e.g. 30 messages), optionally:
  - Call the model once to summarize the oldest M messages into a short “context block” (few sentences).
  - Store that summary (e.g. new field `AiAgentConversation.summary` or a separate `AiAgentConversationSummary` row with a range of message IDs).
  - For the next request, send: [system prompt] + summary + recent N messages.
- Defer this to a later phase if not needed for MVP.

### 2.3 Optional: Multiple threads (conversations)

- **Schema**
  - Already have `AiAgentConversation`; add a user-facing `title` (e.g. auto-generated from first message or editable later).
- **API**
  - **GET** ` /api/v1/ai-agent/conversations` — list conversations for the user (id, title, updatedAt, messageCount).
  - **GET** ` /api/v1/ai-agent/conversation/:id` — get one conversation and its messages (or reuse GET with `?id=`).
  - **POST** ` /api/v1/ai-agent/conversation` — create a new conversation (optional title); returns id.
  - **PATCH** ` /api/v1/ai-agent/conversation/:id` — update title (optional).
  - **DELETE** ` /api/v1/ai-agent/conversation/:id` — delete conversation and messages.
- **Stream**
  - Request body: require or strongly prefer `conversationId`; append new turns to that conversation.
- **Client**
  - Sidebar or dropdown: list conversations; “New conversation”; select one to load into `this.messages` and set “current conversation id” for subsequent sends.
- Implement after Phase 1 is stable.

---

## Phase 3: Client-side state and UX

**Scope:** Faster load and better UX using local state.

### 3.1 Optional: localStorage cache

- After loading or updating a conversation, cache the last K messages (e.g. 50) in localStorage keyed by `userId` and `conversationId`.
- On init: show cached messages immediately (if any), then fetch from API and replace when the response arrives. Reduces perceived latency.
- Invalidate cache when user signs out or when a different conversation is selected.

### 3.2 Optional: Optimistic updates

- When the user sends a message, append the user message to the UI immediately; when the stream completes, append the assistant message. No need to refetch the full conversation unless you want to sync with other tabs.

### 3.3 Accessibility and performance

- Ensure “load conversation” and “sending message” states are announced (e.g. for screen readers).
- If the message list gets very long, consider virtual scrolling for the messages container.

---

## Implementation order (recommended)

| Step | Task | Owner / notes |
|------|------|----------------|
| 1 | Prisma: add `AiAgentConversation` and `AiAgentMessage`, migration | Backend |
| 2 | API: GET `/ai-agent/conversation` (get or create active), service methods | Backend |
| 3 | API: in `chatStream` (and `chat` if used), after success append user + assistant to conversation | Backend |
| 4 | API: when building context, use last N messages from DB for that conversation (by `conversationId` from request or from “active”) | Backend |
| 5 | Client: on AI Agent page init, fetch conversation and set `messages` | Frontend |
| 6 | Client: send `conversationId` in chat/stream request when available | Frontend |
| 7 | Config: add `AI_AGENT_MAX_CONTEXT_MESSAGES` (and optionally token limit) | Backend |
| 8 | (Later) Multiple threads: list/create/switch/delete conversations | Backend + Frontend |
| 9 | (Later) Optional summarization or localStorage cache | Backend + Frontend |

---

## Data model (Phase 1)

```prisma
model AiAgentConversation {
  id        String          @id @default(uuid())
  userId    String
  title     String?         // optional; e.g. "Tax question" or first message snippet
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
  user      User            @relation(fields: [userId], onDelete: Cascade, references: [id])
  messages  AiAgentConversationMessage[]

  @@index([userId])
  @@index([updatedAt])
}

model AiAgentConversationMessage {
  id             String               @id @default(uuid())
  conversationId String
  role           String               // "user" | "assistant"
  content        String
  traceId        String?
  createdAt      DateTime             @default(now())
  conversation   AiAgentConversation  @relation(fields: [conversationId], onDelete: Cascade, references: [id])

  @@index([conversationId])
  @@index([createdAt])
}
```

Add to `User`:

```prisma
aiAgentConversations AiAgentConversation[]
```

---

## API contract (Phase 1)

- **GET** ` /api/v1/ai-agent/conversation`
  - Query: none (or `?id=` for a specific conversation when you add multiple threads).
  - Response: `{ id: string, messages: { role, content, traceId?, createdAt }[] }`. Messages ordered by `createdAt` ascending.
- **POST** ` /api/v1/ai-agent/chat/stream`
  - Body: `{ message: string, conversationId?: string, conversationHistory?: AiAgentMessage[] }`.
  - If `conversationId` is sent, append to that conversation. If omitted, use “active” (e.g. latest by `updatedAt` for the user) or create one.
  - Server appends user message and assistant message after a successful stream completion.

---

## Testing

- Unit: service methods `getOrCreateActiveConversation`, `appendMessages` (with mocked Prisma).
- Integration: GET conversation (empty vs existing), POST stream then GET again and assert two messages appended.
- E2E (optional): open AI Agent page, send a message, refresh, assert message is still there.

---

## Rollback

- If persistence causes issues, feature-flag the “load conversation” and “append on stream” behavior; keep sending `conversationHistory` from the client so behavior reverts to current (in-memory only) when the flag is off.
