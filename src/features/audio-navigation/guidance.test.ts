import { describe, expect, it, vi } from 'vitest';
import { createGuidanceAnnouncer } from './guidance';
describe('step guidance', () => {
  it('reads initial and subsequent questions, including backwards navigation', () => {
    const read = vi.fn(); const announce = createGuidanceAnnouncer(read);
    announce({key:'1|Music',text:'Music. Yes. No.'});
    announce({key:'2|Art',text:'Art. Yes. No.'});
    announce({key:'1|Music',text:'Music. Yes. No.'});
    expect(read.mock.calls.map(([text]) => text)).toEqual(['Music. Yes. No.', 'Art. Yes. No.', 'Music. Yes. No.']);
  });
  it('does not interrupt a question when selections or unrelated content change', () => {
    const read = vi.fn(); const announce = createGuidanceAnnouncer(read);
    announce({key:'11|Times',text:'Pick times. Morning. Afternoon.'});
    announce({key:'11|Times',text:'Pick times. Morning selected. Afternoon.'});
    expect(read).toHaveBeenCalledOnce();
  });
  it('resets when the guided content is removed', () => {
    const read = vi.fn(); const announce = createGuidanceAnnouncer(read);
    announce(null); expect(read).not.toHaveBeenCalled();
    announce({key:'1',text:'First'}); announce(null); announce({key:'1',text:'First'});
    expect(read).toHaveBeenCalledTimes(2);
  });
});
