-- CreateTable
CREATE TABLE "AiAgentConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiAgentConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "traceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAgentConversationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAgentConversation_userId_idx" ON "AiAgentConversation"("userId");

-- CreateIndex
CREATE INDEX "AiAgentConversation_updatedAt_idx" ON "AiAgentConversation"("updatedAt");

-- CreateIndex
CREATE INDEX "AiAgentConversationMessage_conversationId_idx" ON "AiAgentConversationMessage"("conversationId");

-- CreateIndex
CREATE INDEX "AiAgentConversationMessage_createdAt_idx" ON "AiAgentConversationMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "AiAgentConversation" ADD CONSTRAINT "AiAgentConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAgentConversationMessage" ADD CONSTRAINT "AiAgentConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiAgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
