/** "Exampleton only. Coverage: Exampleton 100%, Sampleburg 12%." for a priority that some of the city's places lack. */
export function coverageNote(places: string[], cover: Record<string, number>): string {
  const have = places.filter((n) => cover[n] >= 0.25);
  const only = new Intl.ListFormat('en', { type: 'conjunction' }).format(have.length ? have : places.slice(0, 1));
  return `${only} only. Coverage: ${places.map((n) => `${n} ${Math.round(cover[n] * 100)}%`).join(', ')}.`;
}
