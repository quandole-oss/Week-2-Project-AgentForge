# Video Demo Script — AI Agent MVP

Use this script to record a 3–5 minute demo of the financial portfolio AI agent. Adjust timing and depth as needed.

---

## Before You Record

- [ ] **Server + client running** (or use live deployment)
- [ ] **Logged in** as a user with portfolio/transaction data (so tools return real results)
- [ ] **Feature flag on:** `ENABLE_FEATURE_AI_AGENT=true`
- [ ] **Screen:** 1080p, clear font size; hide clutter (bookmarks bar, extra tabs)
- [ ] **Mic:** Quick sound check; speak clearly and at moderate pace

**Live URL (if not local):** https://ghostfolio-production-64f6.up.railway.app

---

## Act 1 — Intro (30–45 sec)

**Say:**  
*"This is a demo of an AI agent for financial portfolio analysis, built on Ghostfolio. The agent answers natural-language questions about holdings, transactions, taxes, compliance, and allocation using six backend tools."*

**Do:**  
- Show the app (dashboard or portfolio view) briefly, then navigate to the AI agent / chat interface.
- Point out the chat input and any “New conversation” or history controls.

---

## Act 2 — Natural language + tools (1–2 min)

**Say:**  
*"I’ll ask a few questions in plain English; the agent will call the right tools and summarize the results."*

**Do (pick 2–3):**

1. **Portfolio**  
   - Type: *"What’s my portfolio allocation?"*  
   - Send. Let the response stream.  
   - Briefly point out: allocation breakdown, possibly a table or list from `portfolio_summary`.

2. **Transactions**  
   - Type: *"Show me my transaction history for this year"* (or “recent transactions”).  
   - Point out that `transaction_analyzer` was used and the reply summarizes activity/fees.

3. **Tax or compliance**  
   - Type: *"Estimate my capital gains"* or *"Check my portfolio for compliance issues."*  
   - Highlight one sentence that clearly comes from the tool (e.g., tax estimate or compliance note).

**Say (optional):**  
*"Behind the scenes, the agent picks the right tool—portfolio summary, transaction analyzer, tax estimator, compliance checker, and others—and then turns the data into a readable answer."*

---

## Act 3 — Conversation history (30–45 sec)

**Say:**  
*"Conversation is persisted so we can keep context across turns."*

**Do:**  
- Ask a short follow-up that refers to the previous answer, e.g.:  
  *"How does that compare to last month?"* or *"Break that down by asset class."*  
- Show that the reply is relevant to the prior message (no need to re-ask “which portfolio”).
- Optionally click “New conversation,” then show that a new chat starts empty.

---

## Act 4 — Error handling (optional, 20–30 sec)

**Say:**  
*"If something goes wrong, the agent fails gracefully instead of crashing."*

**Do (pick one):**  
- Trigger a benign error if you can (e.g., invalid symbol or a timeout), **or**  
- Just say: *"Errors like missing API keys, timeouts, or tool failures are caught and the user gets a clear message instead of a stack trace."*

---

## Act 5 — Wrap-up (20–30 sec)

**Say:**  
*"So we have: natural-language queries, six tools that run and return structured data, synthesis into coherent answers, persisted conversation history, and basic error handling. The app is deployed and publicly accessible; the link is in the repo docs."*

**Do:**  
- Show the chat one more time or the login/dashboard, then end the recording.

---

## Checklist Before Submit

- [ ] Audio is clear; no long silent stretches.
- [ ] At least one full question → tool result → synthesized answer is visible.
- [ ] Conversation history or “new conversation” is shown.
- [ ] MVP points (natural language, 3+ tools, synthesis, history, errors) are either shown or stated.
- [ ] Length is within your limit (e.g., 3–5 min).

---

## One-liner prompts (copy-paste)

- *What's my portfolio allocation?*
- *Show me my transaction history for 2025*
- *Estimate my capital gains taxes*
- *Check my portfolio for compliance issues*
- *How should I rebalance to 60/30/10?*

Good luck with the recording.
