// The silhouette of a city for the start and loading screens: a coarse grid of hexagons (the same pointy-top hexagons the screens
// draw) with the cells that lie inside the city's outline. Small enough to travel with the list of cities.
import * as turf from '@turf/turf';

const SQ3 = Math.sqrt(3);
const MAX_ROWS = 10; // the stage stays about as tall as it is today
const KM_LON = 111.32; // km per degree of longitude at the equator
const KM_LAT = 110.57; // km per degree of latitude

/**
 * outline: GeoJSON Feature (Polygon or MultiPolygon) of everything that is scored.
 * places:  the places to label ({ name, points: [[lon, lat], ...] }), usually the ones other than the main city.
 * Positions are in units of the hexagon radius: the centre of cell (c, r) is x = c*√3 + (r odd ? √3 : √3/2), y = 1.5*r + 1.
 * Returns { cols, rows, cells: [[c, r], ...], places: [{ name, x, y }] }.
 */
export function buildShape(outline, places = []) {
  const [w, s, e, n] = turf.bbox(outline);
  const kx = Math.cos(((s + n) / 2) * Math.PI / 180) * KM_LON;
  const widthKm = (e - w) * kx, heightKm = (n - s) * KM_LAT;

  // the finest grid whose rows still fit (a city too tall for that gets three columns)
  const fit = (cols) => {
    const unitsPerKm = (cols * SQ3 + SQ3 / 2) / widthKm;
    return { cols, unitsPerKm, rows: Math.floor((heightKm * unitsPerKm - 2) / 1.5) + 1 };
  };
  let grid = fit(18);
  for (let cols = 17; grid.rows > MAX_ROWS && cols >= 3; cols--) grid = fit(cols);
  const { cols, rows, unitsPerKm } = grid;

  const centre = (c, r) => [c * SQ3 + (r % 2 ? SQ3 : SQ3 / 2), 1.5 * r + 1];
  const toLonLat = (x, y) => [w + x / unitsPerKm / kx, n - y / unitsPerKm / KM_LAT];
  const toUnits = (lon, lat) => [(lon - w) * kx * unitsPerKm, (n - lat) * KM_LAT * unitsPerKm];
  const inside = (x, y) => turf.booleanPointInPolygon(turf.point(toLonLat(x, y)), outline);

  const cells = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x, y] = centre(c, r);
      // the centre and six points near the corners: a cell on the edge of the city counts when most of it is inside
      let hit = inside(x, y) ? 1 : 0;
      for (let k = 0; k < 6; k++) {
        const a = (Math.PI / 180) * (60 * k - 30);
        if (inside(x + 0.9 * Math.cos(a), y + 0.9 * Math.sin(a))) hit++;
      }
      if (hit >= 4) cells.push([c, r]);
    }
  }

  const labels = places.map(({ name, points }) => {
    const xy = points.map(([lon, lat]) => toUnits(lon, lat));
    const x = xy.reduce((a, p) => a + p[0], 0) / xy.length;
    // below the lowest of its points, but no lower than the grid reaches
    const y = Math.min(Math.max(...xy.map((p) => p[1])), 1.5 * (rows - 1) + 1) + 2.3;
    return { name, x: +x.toFixed(2), y: +y.toFixed(2) };
  });

  return { cols, rows, cells, places: labels };
}
