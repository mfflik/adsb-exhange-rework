export type ViewMode = '3d' | '2d';

export interface Camera3D {
  readonly mode: '3d';
  // Quaternion rotation of the globe (inverse of camera orientation)
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  // Field of view in degrees
  readonly fovDeg: number;
  // Distance from center (normalized, 1 = surface)
  readonly distance: number;
}

export interface Camera2D {
  readonly mode: '2d';
  // Center longitude in degrees
  readonly centerLon: number;
  // Center latitude in degrees
  readonly centerLat: number;
  // Zoom level (OSM-style, 0-20)
  readonly zoom: number;
}

export type Camera = Camera3D | Camera2D;

export function defaultCamera3D(): Camera3D {
  return {
    mode: '3d',
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    fovDeg: 45,
    distance: 2.5,
  };
}

export function defaultCamera2D(): Camera2D {
  return {
    mode: '2d',
    centerLon: 0,
    centerLat: 20,
    zoom: 3,
  };
}
