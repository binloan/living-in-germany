// Where one average rent counts (a price zone). Two exports, see ADDING_A_CITY.md (step 5).
//
// A zone is the area a shared rent figure counts for: as fine as the rents you can find are published, usually coarser than the areas.
// Here every district is one zone.

/** How seed/rents.json names a zone (also used for its `noData` list). */
export const seedKey = (zone) => zone.id;

/**
 * The price zones and, for every hex, the zone its centre lies in (-1 where no zone contains it; the build assigns those by area).
 * `areas` is generated/areas.json, `cells` the hex grid (cache/cells.base.json), both in the order the build reads them.
 * @returns {{ zones: { id: string, name: string, city: string, district: string }[], cellZone: number[] }}
 */
export function assignZones({ areas, cells }) {
  const zones = [];
  const zoneOfDistrict = new Map();
  const zoneOfArea = areas.features.map((f) => {
    const { district, city } = f.properties;
    if (!zoneOfDistrict.has(district)) { zoneOfDistrict.set(district, zones.length); zones.push({ id: `Z${String(zones.length + 1).padStart(2, '0')}`, name: district, city, district }); }
    return zoneOfDistrict.get(district);
  });
  return { zones, cellZone: cells.area.map((a) => zoneOfArea[a]) };
}
