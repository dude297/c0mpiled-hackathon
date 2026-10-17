// Feature-scoped selectors use Sparsh's existing theme tokens, not global overrides.
export const audioStyles = `
.db-audio-shell { position: fixed; right: 1rem; bottom: 1rem; z-index: 50; font-family: var(--font-geist-sans), system-ui, sans-serif; font-size: 1rem; line-height: 1.5; color: var(--foreground, #171717); }
.db-audio-skip { position: fixed; left: 1rem; top: 1rem; transform: translateY(-200%); padding: 1rem; background: var(--background, white); color: var(--foreground, #171717); border: 3px solid currentColor; border-radius: .5rem; z-index: 100; }
.db-audio-skip:focus { transform: translateY(0); }
.db-audio-settings { width: 100%; padding: .5rem 0; }
.db-audio-settings summary { cursor: pointer; padding: .75rem 0; }
.db-audio-settings summary:focus-visible { outline: 3px solid currentColor; }
.db-audio-toggle { display: flex; align-items: center; justify-content: center; min-height: 44px; padding: .65rem 1rem; border: 1px solid var(--border, #d4d4d4); border-radius: 999px; background: var(--foreground, #171717); color: var(--background, white); cursor: pointer; list-style: none; box-shadow: 0 2px 8px #0002; font-weight: 600; }
.db-audio-toggle::-webkit-details-marker { display: none; }
.db-audio-toggle:focus-visible { outline: 3px solid var(--foreground, #171717); outline-offset: 3px; }
.db-audio-panel { position: absolute; right: 0; bottom: calc(100% + .75rem); width: min(26rem, calc(100vw - 2rem)); max-height: min(70vh, 40rem); overflow: auto; padding: 1rem; border: 1px solid var(--border, #d4d4d4); border-radius: 1rem; background: var(--background, white); box-shadow: 0 8px 32px #0002; }
.db-audio-top, .db-audio-controls, .db-audio-mic-status { max-width: min(26rem, calc(100vw - 2rem)); font-size: .9rem; background: var(--background, white); border-radius: .5rem; }
.db-audio-mic-status p { margin: .25rem; }
.db-audio-voice { border-top: 1px solid var(--border, #d4d4d4); margin-top: .75rem; }
.db-audio-bottom { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
.db-audio-top strong { font-size: 1.125rem; }
.db-audio-help { margin: .75rem 0; font-size: .95rem; }
.db-audio-button, .db-audio-setting select, .db-audio-link { min-height: 44px; padding: .5rem .75rem; border-radius: .5rem; }
.db-audio-button { border: 1px solid var(--border, #d4d4d4); background: var(--background, white); color: inherit; font: inherit; cursor: pointer; }
.db-audio-button:hover:not(:disabled) { background: var(--muted, #f5f5f5); }
.db-audio-button:disabled { opacity: .6; cursor: default; }
.db-audio-button:focus-visible, .db-audio-setting select:focus-visible, .db-audio-setting input:focus-visible, .db-audio-link:focus-visible { outline: 3px solid var(--foreground, #171717); outline-offset: 2px; }
.db-audio-link { display: inline-flex; align-items: center; text-decoration: underline; color: inherit; }
.db-audio-setting { max-width: 100%; min-width: 0; display: inline-flex; align-items: center; flex-wrap: wrap; gap: .5rem; min-height: 44px; }
.db-audio-setting select { max-width: min(100%, 20rem); border: 1px solid var(--border, #d4d4d4); background: var(--background, white); color: inherit; font: inherit; }
.db-audio-setting input { width: 1.25rem; height: 1.25rem; accent-color: var(--foreground, #171717); }
.db-audio-mic-status { max-width: min(26rem, calc(100vw - 2rem)); font-size: .9rem; background: var(--background, white); border-radius: .5rem; }
.db-audio-mic-status p { margin: .25rem; }
.db-audio-voice { border-top: 1px solid var(--border, #d4d4d4); margin-top: .75rem; }
.db-audio-bottom { margin-top: .75rem; }
@media print { .db-audio-shell { display: none; } }
`;
