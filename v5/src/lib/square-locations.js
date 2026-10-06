/** Match a bar name to a Square location when there is exactly one hit. */

export function normalizeLocationName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * @param {string} barName
 * @param {Array<{ id: string, name: string }>} locations
 * @param {Set<string>} takenIds location ids already linked to another bar
 */
export function suggestSquareLocation(barName, locations, takenIds = new Set()) {
  const key = normalizeLocationName(barName);
  if (!key) return null;
  const hits = (locations || []).filter((location) =>
    normalizeLocationName(location.name) === key && !takenIds.has(location.id));
  return hits.length === 1 ? hits[0].id : null;
}
