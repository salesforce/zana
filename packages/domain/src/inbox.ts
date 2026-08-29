/** Slice of product.ts — inbox / suggestion vocabulary. */

export type {
  InboxDoc,
  InboxNotifyLevel,
  InboxQuestionOption,
  InboxQuestion,
  InboxOrigin,
  SuggestedActionKind,
  SuggestionInput,
  Suggestion,
  InboxEntry,
  InboxDigest,
  InboxSummaryResult,
  DetailedInboxPoint,
  DetailedInboxSection,
  DetailedInboxDigest,
  DetailedInboxSummaryResult,
  FeedNoiseResult
} from './product.js';

export {
  STANDALONE_SUGGESTION_KINDS,
  inboxQuestions,
  hasBlockingQuestion
} from './product.js';
