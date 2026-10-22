const MS_PER_DAY = 86_400_000;

export interface LabeledTerm {
  key: string;
  label: string;
  year: number;
  ordinal: number;
  startDate: string;
  endDate: string;
}

export interface TermOpts { minRun?: number; year?: number }
const gapDays = (a: string, b: string) => (Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / MS_PER_DAY;

// All terms in chronological order. A term boundary is a gap > termGapDays between consecutive sorted dates (same rule
// as terms.ts). Pass week-bucketed dates (callers do). minRun (spec 2026-10-22 §5.3.3): a run with fewer dates joins the
// neighbouring run with the smaller gap, so one holiday event is not a term. year: number every run in that calendar
// year (the audit builds one calendar year; a first week can start in the previous December).
export function computeAllTerms(dates: string[], termGapDays: number, opts: TermOpts = {}): LabeledTerm[] {
  const uniq = [...new Set(dates.filter(Boolean))].sort();
  if (uniq.length === 0) return [];
  const runs: string[][] = [[uniq[0]!]];
  for (let i = 1; i < uniq.length; i++) {
    if (gapDays(uniq[i - 1]!, uniq[i]!) > termGapDays) runs.push([]);
    runs[runs.length - 1]!.push(uniq[i]!);
  }
  for (;;) {
    const i = runs.findIndex((r) => r.length < (opts.minRun ?? 1));
    if (i === -1 || runs.length < 2) break;
    const before = i > 0 ? gapDays(runs[i - 1]!.at(-1)!, runs[i]![0]!) : Infinity;
    const after = i < runs.length - 1 ? gapDays(runs[i]!.at(-1)!, runs[i + 1]![0]!) : Infinity;
    const lo = before <= after ? i - 1 : i;
    runs.splice(lo, 2, [...runs[lo]!, ...runs[lo + 1]!]);
  }
  const perYear = new Map<number, number>();
  return runs.map((r) => {
    const startDate = r[0]!, endDate = r.at(-1)!;
    const year = opts.year ?? Number(startDate.slice(0, 4));
    const ordinal = (perYear.get(year) ?? 0) + 1;
    perYear.set(year, ordinal);
    return { key: `${year}-T${ordinal}`, label: `Term ${ordinal} ${year}`, year, ordinal, startDate, endDate };
  });
}
