-- CreateTable
CREATE TABLE "AiAgentFeedback" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "correction" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAgentFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAgentEvalResult" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "toolsCalled" TEXT[],
    "assertions" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAgentEvalResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAgentFeedback_userId_idx" ON "AiAgentFeedback"("userId");

-- CreateIndex
CREATE INDEX "AiAgentFeedback_traceId_idx" ON "AiAgentFeedback"("traceId");

-- CreateIndex
CREATE INDEX "AiAgentEvalResult_runId_idx" ON "AiAgentEvalResult"("runId");

-- CreateIndex
CREATE INDEX "AiAgentEvalResult_caseId_idx" ON "AiAgentEvalResult"("caseId");

-- CreateIndex
CREATE INDEX "AiAgentEvalResult_createdAt_idx" ON "AiAgentEvalResult"("createdAt");

-- AddForeignKey
ALTER TABLE "AiAgentFeedback" ADD CONSTRAINT "AiAgentFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
