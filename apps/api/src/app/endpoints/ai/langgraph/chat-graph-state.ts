import type { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

import type { Filter } from '@ghostfolio/common/interfaces';

export type RouteType = 'data' | 'advice' | 'general';
export type ComplianceDecision = 'approve' | 'warn' | 'block';

/**
 * Graph state for the 4-agent LangGraph chat.
 * All nodes read/write this state; node outputs are merged.
 */
export const ChatGraphStateAnnotation = Annotation.Root({
  complianceDecision: Annotation<ComplianceDecision | undefined>({
    default: () => undefined
  }),
  complianceMessage: Annotation<string | undefined>({
    default: () => undefined
  }),
  draftReply: Annotation<string | undefined>({
    default: () => undefined
  }),
  filters: Annotation<Filter[] | undefined>({
    default: () => undefined
  }),
  finalContent: Annotation<string>({
    default: () => ''
  }),
  impersonationId: Annotation<string | undefined>({
    default: () => undefined
  }),
  messages: Annotation<BaseMessage[]>({
    default: () => []
  }),
  route: Annotation<RouteType | undefined>({
    default: () => undefined
  }),
  userId: Annotation<string>({
    default: () => ''
  }),
  userCurrency: Annotation<string>({
    default: () => ''
  })
});

export type ChatGraphState = typeof ChatGraphStateAnnotation.State;
