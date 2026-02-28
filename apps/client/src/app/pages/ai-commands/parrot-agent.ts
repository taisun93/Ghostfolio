/**
 * Parrot agent: produces a quick, local rephrasing of the user's message
 * to show as an immediate first response before the real AI reply.
 * No network or LLM — instant, deterministic.
 */

const PREFIXES = [
  "Got it — you're asking about ",
  "Looking into that. So you want to know about ",
  "On it. You're asking: ",
  "Checking that for you — ",
  "Sure. So: ",
  "Understood — "
];

/**
 * Light rephrasing so the parrot doesn't just repeat verbatim.
 * Lowercase, trim, and optionally swap first-person to second for flow.
 */
function rephrase(s: string): string {
  let t = s.trim().toLowerCase();
  if (!t) return s;
  // Soft first-person → second-person in common patterns for "you're asking about X"
  t = t.replace(/\bmy\b/g, 'your');
  t = t.replace(/\b(i'm|i am)\s+/gi, '');
  t = t.replace(/\b(show|tell)\s+me\b/gi, (_, verb) => (verb === 'show' ? 'show' : 'tell'));
  // Capitalize first letter for display
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Returns a short parrot response for the given user message.
 * Synchronous and fast; safe to call from the UI thread.
 */
export function parrotResponse(userMessage: string): string {
  const trimmed = userMessage?.trim() || '';
  if (!trimmed) return 'Got it.';
  const prefix = PREFIXES[trimmed.length % PREFIXES.length];
  const rephrased = rephrase(trimmed);
  return prefix + rephrased + (rephrased.endsWith('?') ? '' : '.');
}
