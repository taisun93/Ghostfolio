-- CreateTable
CREATE TABLE "AiChatConversation" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "AiChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiChatConversation_userId_updatedAt_idx" ON "AiChatConversation"("userId", "updatedAt" DESC);

-- AddForeignKey
ALTER TABLE "AiChatConversation" ADD CONSTRAINT "AiChatConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
