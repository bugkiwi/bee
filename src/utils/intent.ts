/**
 * Planning intent detection.
 *
 * Returns true when a chat message looks like a multi-step development task
 * that should be decomposed into a plan rather than answered conversationally.
 */

/** Verbs that clearly signal "do this thing" (imperative or infinitive) */
const PLANNING_VERBS =
  /\b(build|implement|create|develop|add|make|set\s+up|setup|integrate|write|migrate|upgrade|refactor|replace|convert|extend|scaffold|generate|deploy|configure|design|architect|wire\s+up|hook\s+up|connect|enable|introduce|bootstrap|init(?:ialize)?)\b/i;

/** Phrases that signal a question or conversational intent — NOT planning */
const QUESTION_PREFIXES =
  /^(how|what|why|where|when|who|which|is |are |can |could |should |would |do |does |did |explain|tell me|show me|describe|list|help me understand|what is|what are|what does|what if|why does|how does|can you tell|could you explain)/i;

/** Conversational starters — definitely not planning */
const CONVERSATIONAL_STARTERS =
  /^(hi\b|hello\b|hey\b|thanks|thank you|ok\b|okay\b|yes\b|no\b|sure\b|sounds good|got it|i see|great\b|cool\b|nice\b|interesting|perfect\b|makes sense)/i;

export function detectPlanningIntent(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;

  // Conversational starters → not planning
  if (CONVERSATIONAL_STARTERS.test(trimmed)) return false;

  // Questions → not planning
  if (QUESTION_PREFIXES.test(trimmed)) return false;

  // "I want/need/would like to <verb>" patterns — check early before word count
  if (/^i\s+(want|need)\s+to\s+/i.test(trimmed) ||
      /^i\s+would\s+like\s+to\s+/i.test(trimmed) ||
      /^i'?d\s+like\s+to\s+/i.test(trimmed)) {
    return PLANNING_VERBS.test(trimmed);
  }

  // "Let's / let's <verb>" — also check before word count
  if (/^let'?s\s+/i.test(trimmed) || /^lets\s+/i.test(trimmed)) {
    return PLANNING_VERBS.test(trimmed);
  }

  // Generic: short messages are rarely planning requests
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < 4) return false;

  // Starts with a planning verb (imperative)
  if (PLANNING_VERBS.test(trimmed.split(/\s+/)[0] ?? "")) {
    return true;
  }

  return false;
}
