/**
 * Basemaps.
 *
 * All three are free raster tile services that need no API key — the contract's stack note is
 * explicit about avoiding a keyed provider, and a demo that fails because a key expired is a
 * demo that fails.
 *
 * `imagery` is the default. The visual reference's geographic authority comes from satellite
 * relief: you can see the Himalayan corridor the delivery has to cross. The previous build used
 * OSM raster forced through `grayscale(1) brightness(0.52)`, which is why its map read as a flat
 * grey rectangle. The filter applied here (in tokens.css) settles the imagery's saturation
 * without draining the terrain.
 */

export type BasemapId = 'imagery' | 'terrain' | 'light';

export interface Basemap {
  id: BasemapId;
  label: string;
  url: string;
  attribution: string;
  maxZoom: number;
  /** Applied to the map container, so tokens.css can tone each basemap differently. */
  className: string;
  /** A labels-only overlay drawn above the base tiles, where the base has no place names. */
  labelsUrl?: string;
  /** Overlay tone for panels floating on this basemap. */
  overlayTheme: 'onDark' | 'onLight';
}

export const BASEMAPS: Record<BasemapId, Basemap> = {
  imagery: {
    id: 'imagery',
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 18,
    className: 'basemap-imagery',
    // Esri's imagery carries no place names; this transparent reference layer supplies them.
    labelsUrl:
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    overlayTheme: 'onDark',
  },
  terrain: {
    id: 'terrain',
    label: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: '&copy; OpenTopoMap, &copy; OpenStreetMap contributors',
    maxZoom: 17,
    className: 'basemap-light',
    overlayTheme: 'onLight',
  },
  light: {
    id: 'light',
    label: 'Plain',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap contributors, &copy; CARTO',
    maxZoom: 19,
    className: 'basemap-light',
    overlayTheme: 'onLight',
  },
};

export const DEFAULT_BASEMAP: BasemapId = 'imagery';

export const BASEMAP_OPTIONS = [
  { value: 'imagery' as const, label: 'Satellite' },
  { value: 'terrain' as const, label: 'Terrain' },
  { value: 'light' as const, label: 'Plain' },
];

// ---------------------------------------------------------------------------
// Map layer identifiers — what the floating layer panel toggles
// ---------------------------------------------------------------------------

export type MapLayerId =
  | 'routes'
  | 'vehicles'
  | 'incidents'
  | 'riskZones'
  | 'facilities'
  | 'weather';

export interface MapLayerToggle {
  id: MapLayerId;
  label: string;
  icon: 'routes' | 'vehicle' | 'incidents' | 'risk' | 'warehouse' | 'weather';
}

export const MAP_LAYERS: MapLayerToggle[] = [
  { id: 'routes', label: 'Routes', icon: 'routes' },
  { id: 'vehicles', label: 'Vehicles', icon: 'vehicle' },
  { id: 'incidents', label: 'Incidents', icon: 'incidents' },
  { id: 'riskZones', label: 'Risk zones', icon: 'risk' },
  { id: 'facilities', label: 'Warehouses', icon: 'warehouse' },
  { id: 'weather', label: 'Weather', icon: 'weather' },
];

export const ALL_LAYERS_ON: Record<MapLayerId, boolean> = {
  routes: true,
  vehicles: true,
  incidents: true,
  riskZones: true,
  facilities: true,
  weather: false,
};
