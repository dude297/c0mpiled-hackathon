import { isReadable, readableText } from "./page-text";

export interface Guidance { key: string; text: string }
// Uses the existing onboarding focus markers; no duplicate question/option catalog.
export function currentGuidance(): Guidance | null {
  const marker = Array.from(document.querySelectorAll<HTMLElement>('[data-step-focus]')).find(isReadable);
  if (!marker) return null;
  const card = marker.matches('h2, h3') ? marker.parentElement : marker;
  if (!card) return null;
  let deck = marker.parentElement;
  while (deck && !deck.querySelector('[role="progressbar"]')) deck = deck.parentElement;
  const progress = deck?.querySelector('[role="progressbar"]');
  const count = progress ? `Question ${Number(progress.getAttribute('aria-valuenow') ?? 0) + 1} of ${progress.getAttribute('aria-valuemax')}.` : '';
  const title = marker.getAttribute('aria-label') || marker.textContent?.trim() || '';
  // Review is deliberately heading-only: do not automatically narrate personal answers.
  const review = /here.s what we heard/i.test(title);
  const namePrompt = progress?.getAttribute('aria-valuenow') === '0'
    ? 'First, what should we call you? Enter your name in the name field. Then answer the interest question. ' : '';
  const navigation = marker.matches('[role="group"]') && marker.getAttribute('aria-label')?.includes('Left arrow')
    ? 'When this card has keyboard focus, press the right arrow key for Yes on the right, or the left arrow key for No on the left. Or press Tab to reach the Yes or No button, then press Enter.'
    : 'Use Tab to move through the answers. Press Enter or Space to choose.';
  const text = review ? `${title}. Review your answers. Use Tab to reach each change button.`
    : `${namePrompt}${count} ${readableText(card)}. ${navigation}`;
  return { key: `${count}|${title}`, text: text.replace(/\s+/g, ' ').trim() };
}

// Selection changes within a question do not restart its narration.
export function createGuidanceAnnouncer(read: (text: string) => void) {
  let previous = '';
  return (guidance: Guidance | null) => {
    if (!guidance) { previous = ''; return false; }
    if (guidance.key === previous) return false;
    previous = guidance.key;
    read(guidance.text);
    return true;
  };
}
