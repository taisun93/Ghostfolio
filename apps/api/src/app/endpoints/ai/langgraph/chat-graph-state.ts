import type { BaseMessage } from '@langchain/core/messages';
import { Annotation } from '@langchain/langgraph';

import type { Filter } from '@ghostfolio/common/interfaces';

export type RouteType = 'data' | 'advice' | 'general';
export type ComplianceDecision = 'approve' | 'warn' | 'block';

/** Record of a single tool invocation (for trace/eval). */
export interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: string;
}

/** Reducer: replace with update when present, else keep current (for last-value semantics). */
const replace = <T>(_left: T, right: T): T => (right !== undefined ? right : _left) as T;

/**
 * Graph state for the 4-agent LangGraph chat.
 * All nodes read/write this state; node outputs are merged.
 */
export const ChatGraphStateAnnotation = Annotation.Root({
  complianceDecision: Annotation<ComplianceDecision | undefined>({
    reducer: replace,
    default: () => undefined
  }),
  complianceMessage: Annotation<string | undefined>({
    reducer: replace,
    default: () => undefined
  }),
  draftReply: Annotation<string | undefined>({
    reducer: replace,
    default: () => undefined
  }),
  filters: Annotation<Filter[] | undefined>({
    reducer: replace,
    default: () => undefined
  }),
  finalContent: Annotation<string>({
    reducer: (_, right) => (right !== undefined ? right : ''),
    default: () => ''
  }),
  impersonationId: Annotation<string | undefined>({
    reducer: replace,
    default: () => undefined
  }),
  messages: Annotation<BaseMessage[]>({
    reducer: (left, right) =>
      Array.isArray(right) ? left.concat(right) : right !== undefined ? left.concat([right]) : left,
    default: () => []
  }),
  route: Annotation<RouteType | undefined>({
    reducer: replace,
    default: () => undefined
  }),
  toolCalls: Annotation<ToolCallRecord[]>({
    reducer: replace,
    default: () => []
  }),
  userId: Annotation<string>({
    reducer: (_, right) => (right !== undefined ? right : ''),
    default: () => ''
  }),
  userCurrency: Annotation<string>({
    reducer: (_, right) => (right !== undefined ? right : ''),
    default: () => ''
  })
});

export type ChatGraphState = typeof ChatGraphStateAnnotation.State;
