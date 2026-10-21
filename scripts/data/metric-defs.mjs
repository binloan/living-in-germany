// The metric definitions of one city: the shared definitions (data/metrics.json) with the city's own descriptions on top
// (cities/<id>/metrics.json), and the {placeholders} of the shared texts filled from the city's `texts`.

const TEXT_FIELDS = ['label', 'hint', 'info', 'note'];

/** Fills {name} in a text; a name the city does not define is an error, so a gap never reaches the app as "{name}". */
export function fillTexts(text, texts, where) {
  return text.replace(/\{(\w+)\}/g, (_, name) => {
    if (!(name in texts)) throw new Error(`${where}: the city has no text "${name}" (texts in its city.json)`);
    return texts[name];
  });
}

export function resolveMetricDefs(shared, overrides, texts, cityId) {
  for (const id of Object.keys(overrides)) {
    if (!shared.some((d) => d.id === id)) throw new Error(`${cityId}: metrics.json describes "${id}", which is not a metric`);
  }
  return shared.map((d) => {
    // the ruler is the same in every city; a city that could move it would make its scores incomparable
    if (overrides[d.id] && 'scale' in overrides[d.id]) throw new Error(`${cityId}: metrics.json may not set the scale of "${d.id}"; it is shared so that scores compare between cities`);
    const m = { ...d, ...overrides[d.id] };
    for (const k of TEXT_FIELDS) if (typeof m[k] === 'string') m[k] = fillTexts(m[k], texts, `${cityId}: metric ${d.id}, ${k}`);
    return m;
  });
}
