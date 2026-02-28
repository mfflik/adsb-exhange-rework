// MapTalks map initialization with OSM basemap
import * as maptalks from 'maptalks';

export interface MapInstance {
  readonly map: maptalks.Map;
  readonly tileLayer: maptalks.TileLayer;
}

export function createMap(containerId: string): MapInstance {
  // OSM tile layer
  const tileLayer = new maptalks.TileLayer('osm', {
    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    subdomains: ['a', 'b', 'c'],
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
  });

  const map = new maptalks.Map(containerId, {
    center: [0, 20],
    zoom: 3,
    minZoom: 1,
    maxZoom: 18,
    baseLayer: tileLayer,
    zoomAnimation: true,
    zoomAnimationDuration: 200,
    panAnimation: true,
    pitch: 0,
    bearing: 0,
  });

  return { map, tileLayer };
}

/** Get screen pixel coordinates for a lat/lon point */
export function latLonToPixel(
  map: maptalks.Map,
  lat: number,
  lon: number
): { x: number; y: number } | null {
  const coord = new maptalks.Coordinate(lon, lat);
  const point = map.coordinateToContainerPoint(coord);
  if (!point) return null;
  const x = point.x;
  const y = point.y;
  if (x === null || y === null) return null;
  return { x: x as number, y: y as number };
}

/** Get current map viewport bounds */
export function getMapBounds(map: maptalks.Map): {
  minLon: number; maxLon: number;
  minLat: number; maxLat: number;
} {
  const extent = map.getExtent();
  return {
    minLon: (extent.xmin ?? -180) as number,
    maxLon: (extent.xmax ?? 180) as number,
    minLat: (extent.ymin ?? -90) as number,
    maxLat: (extent.ymax ?? 90) as number,
  };
}
