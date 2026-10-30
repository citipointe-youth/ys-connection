import { describe, it, expect } from 'vitest';
import { ID_CHECK_SECTIONS, ID_CHECK_KEYS } from '../core/id-check-questions';

describe('ID check question bank', () => {
  it('has the six sections in order with 10, 11, 10, 10, 9, 12 questions (62)', () => {
    expect(ID_CHECK_SECTIONS.map((s) => s.key)).toEqual(['faith', 'form', 'family', 'finances', 'fruit', 'general']);
    expect(ID_CHECK_SECTIONS.map((s) => s.questions.length)).toEqual([10, 11, 10, 10, 9, 12]);
    expect(ID_CHECK_KEYS.size).toBe(62);
  });
  it('keys are <section><NN>, two-digit, in order, unique', () => {
    const all = ID_CHECK_SECTIONS.flatMap((s) => s.questions.map((q, i) => [s.key, q.key, i + 1] as const));
    for (const [sec, key, n] of all) expect(key).toBe(`${sec}${String(n).padStart(2, '0')}`);
    expect(new Set(all.map((a) => a[1])).size).toBe(all.length);
    for (const k of all.map((a) => a[1])) expect(ID_CHECK_KEYS.has(k)).toBe(true);
  });
  it('pins exact texts, titles and subtitles', () => {
    const q = (k: string) => ID_CHECK_SECTIONS.flatMap((s) => s.questions).find((x) => x.key === k)!;
    expect(q('faith01').text).toBe("How's your relationship with God?");
    expect(q('form05').text).toBe('Do you think that ___ is beneficial? What do you think about that?');
    expect(q('general12').text).toBe('Do you have any questions?');
    const faith = ID_CHECK_SECTIONS[0]!;
    expect(faith.title).toBe('FAITH');
    expect(faith.subtitle).toBe('their walk with God');
    expect(ID_CHECK_SECTIONS.map((s) => s.title)).toEqual(['FAITH', 'FORM', 'FAMILY/FRIENDS', 'FINANCES', 'FRUIT', 'GENERAL']);
  });
  it('has no retired question yet and no empty text', () => {
    for (const s of ID_CHECK_SECTIONS) for (const q of s.questions) { expect(q.retired).toBeUndefined(); expect(q.text.trim()).not.toBe(''); }
  });
});
