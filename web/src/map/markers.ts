/**
 * Custom map markers.
 *
 * Leaflet's default marker is a blue teardrop PNG; nothing about it belongs in this product.
 * Every marker here is an inline-SVG `divIcon` built from the design tokens, so a warehouse pin
 * and a warehouse icon in a table are recognisably the same object.
 *
 * All of them carry a white casing stroke. Over satellite imagery — which is dark, mottled and
 * high-contrast — a mark without a casing disappears; this is the single detail that decides
 * whether the map reads as designed or as a debug view.
 */

import L from 'leaflet';
import type { RiskLevel } from '@/domain/types';
import { RISK_TONE } from '@/domain/thresholds';

const CSS = {
  panel: 'rgb(255,255,255)',
  ink: 'rgb(14,27,42)',
  brand: 'rgb(18,118,184)',
  brandDeep: 'rgb(10,58,92)',
} as const;

/** A soft drop shadow so a mark lifts off the imagery. Declared once, reused by every icon. */
const SHADOW = `<filter id="mk-shadow" x="-40%" y="-40%" width="180%" height="180%">
    <feDropShadow dx="0" dy="1" stdDeviation="1.4" flood-color="rgb(14,27,42)" flood-opacity="0.45"/>
  </filter>`;

/**
 * Every icon is built through here, and the same spec always returns the same `L.DivIcon`.
 *
 * This is about clicks, not speed. react-leaflet calls `marker.setIcon()` whenever the `icon`
 * prop is a different object, and Leaflet's `setIcon` rewrites the icon's innerHTML. The map
 * re-renders on the pointer's first `mousedown` (that is what arms wheel zoom), so with a fresh
 * icon per render the element under the pointer was replaced between mousedown and mouseup and
 * the browser fired no `click` at all: the first click on a route chip or a vehicle after
 * entering the map did nothing (Phase 5A.2). With a stable instance `setIcon` is never called.
 *
 * The inputs are a small closed set (risk levels, selection, a few titles and bearings), so the
 * cache stays small; the cap is only a guard.
 */
const ICON_CACHE = new Map<string, L.DivIcon>();
const ICON_CACHE_MAX = 500;

function cachedIcon(options: L.DivIconOptions & { html: string }): L.DivIcon {
  const key = `${options.className}|${String(options.iconSize)}|${String(options.iconAnchor)}|${options.html}`;
  let icon = ICON_CACHE.get(key);
  if (!icon) {
    if (ICON_CACHE.size >= ICON_CACHE_MAX) ICON_CACHE.clear();
    icon = L.divIcon(options);
    ICON_CACHE.set(key, icon);
  }
  return icon;
}

function divIcon(html: string, size: number, anchor?: [number, number]): L.DivIcon {
  return cachedIcon({
    html,
    className: 'marker-plain',
    iconSize: [size, size],
    iconAnchor: anchor ?? [size / 2, size / 2],
  });
}

// ---------------------------------------------------------------------------
// Vehicle — a chevron rotated to the direction of travel
// ---------------------------------------------------------------------------

export function vehicleIcon(level: RiskLevel, bearing = 0, selected = false): L.DivIcon {
  const color = RISK_TONE[level].cssVar;
  const size = selected ? 34 : 28;
  const r = selected ? 13 : 11;

  const html = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>${SHADOW}</defs>
      ${
        selected
          ? `<circle cx="${size / 2}" cy="${size / 2}" r="${r + 3}" fill="${color}" opacity="0.22"/>`
          : ''
      }
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="${color}"
              stroke="${CSS.panel}" stroke-width="2.5" filter="url(#mk-shadow)"/>
      <g transform="rotate(${bearing} ${size / 2} ${size / 2})">
        <path d="M${size / 2} ${size / 2 - 5.5} L${size / 2 + 4} ${size / 2 + 4}
                 L${size / 2} ${size / 2 + 1.8} L${size / 2 - 4} ${size / 2 + 4} Z"
              fill="${CSS.panel}"/>
      </g>
    </svg>`;
  return divIcon(html, size);
}

// ---------------------------------------------------------------------------
// Facilities — warehouse and destination
// ---------------------------------------------------------------------------

/** A rounded square pin. Squares read as fixed infrastructure; circles read as things that move. */
export function facilityIcon(kind: 'warehouse' | 'hospital' | 'origin'): L.DivIcon {
  const size = 30;
  const fill = kind === 'hospital' ? RISK_TONE.CRITICAL.cssVar : CSS.brandDeep;

  const glyph =
    kind === 'warehouse'
      ? `<path d="M9 19v-6.6l6-3.4 6 3.4V19h-3.6v-4.2h-4.8V19Z" fill="${CSS.panel}"/>`
      : kind === 'hospital'
        ? `<path d="M13.5 9h3v3h3v3h-3v3h-3v-3h-3v-3h3Z" fill="${CSS.panel}"/>`
        : `<circle cx="15" cy="14.5" r="4.2" fill="none" stroke="${CSS.panel}" stroke-width="2.4"/>`;

  const html = `
    <svg width="${size}" height="${size}" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
      <defs>${SHADOW}</defs>
      <rect x="3" y="2.5" width="24" height="24" rx="7" fill="${fill}"
            stroke="${CSS.panel}" stroke-width="2.2" filter="url(#mk-shadow)"/>
      ${glyph}
    </svg>`;
  return divIcon(html, size, [size / 2, size / 2]);
}

// ---------------------------------------------------------------------------
// Incident — a triangle, the universal hazard shape
// ---------------------------------------------------------------------------

export function incidentIcon(severity: RiskLevel, active = false): L.DivIcon {
  const color = RISK_TONE[severity].cssVar;
  const size = 30;

  const html = `
    <svg width="${size}" height="${size}" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg">
      <defs>${SHADOW}</defs>
      ${active ? `<circle cx="15" cy="15" r="13.5" fill="${color}" opacity="0.20"/>` : ''}
      <path d="M15 4.4 L26.4 24.2 H3.6 Z" fill="${color}"
            stroke="${CSS.panel}" stroke-width="2.2" stroke-linejoin="round" filter="url(#mk-shadow)"/>
      <rect x="13.9" y="11.6" width="2.2" height="6.4" rx="1.1" fill="${CSS.panel}"/>
      <circle cx="15" cy="20.6" r="1.25" fill="${CSS.panel}"/>
    </svg>`;
  return divIcon(html, size, [size / 2, size / 2 + 4]);
}

// ---------------------------------------------------------------------------
// Pick — the temporary pin for a location the user is choosing
// ---------------------------------------------------------------------------

/**
 * A teardrop pin in the brand colour, anchored at its tip. Deliberately NOT the hazard triangle:
 * until the report is filed nothing has been reported, and a pending selection that looked like
 * an incident would be a marker claiming something that has not happened. A dashed ring marks
 * it as provisional.
 */
export function pickIcon(): L.DivIcon {
  const w = 30;
  const h = 40;
  const html = `
    <svg width="${w}" height="${h}" viewBox="0 0 30 40" xmlns="http://www.w3.org/2000/svg">
      <defs>${SHADOW}</defs>
      <ellipse cx="15" cy="37.5" rx="6" ry="2" fill="${CSS.brandDeep}" opacity="0.25"/>
      <path d="M15 2 C8 2 3 7.2 3 13.8 C3 22.4 15 36 15 36 C15 36 27 22.4 27 13.8 C27 7.2 22 2 15 2 Z"
            fill="${CSS.brand}" stroke="${CSS.panel}" stroke-width="2.2" filter="url(#mk-shadow)"/>
      <circle cx="15" cy="13.8" r="5.4" fill="none" stroke="${CSS.panel}" stroke-width="1.6" stroke-dasharray="2.4 1.8"/>
      <circle cx="15" cy="13.8" r="2" fill="${CSS.panel}"/>
    </svg>`;
  // Not `divIcon()`, which assumes a square: the pin is taller than it is wide, and its anchor
  // is the tip, so the point the user clicked is exactly where the pin touches the ground.
  return cachedIcon({ html, className: 'marker-plain', iconSize: [w, h], iconAnchor: [w / 2, 36] });
}

// ---------------------------------------------------------------------------
// Waypoint — a small node on a route
// ---------------------------------------------------------------------------

export function waypointIcon(level: RiskLevel = 'LOW', size = 12): L.DivIcon {
  const color = RISK_TONE[level].cssVar;
  const html = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${color}"
              stroke="${CSS.panel}" stroke-width="2"/>
    </svg>`;
  return divIcon(html, size);
}

// ---------------------------------------------------------------------------
// Route callout — the "Route A · Risk 87% · ETA 7h 20m" chip anchored to a route
// ---------------------------------------------------------------------------

export interface CalloutSpec {
  title: string;
  riskScore: number;
  etaLabel: string;
  level: RiskLevel;
  recommended?: boolean;
  /** The route currently open in the intelligence panel. */
  selected?: boolean;
  /**
   * How far above its anchor point the chip floats, in px.
   *
   * Candidate routes share their origin and destination and run together near both ends, so spreading
   * the anchors along the corridor is not enough on its own — at corridor zoom the three chips
   * still land within ~30px of each other. Staggering them vertically as well separates them
   * reliably at any zoom.
   */
  offsetY?: number;
}

/**
 * An HTML `divIcon` rather than SVG, so it inherits the product's real typography instead of
 * re-approximating it in SVG text. Width is fixed at 132px so several callouts on one map stay
 * aligned and predictable.
 */
export function routeCalloutIcon(spec: CalloutSpec): L.DivIcon {
  const color = RISK_TONE[spec.level].cssVar;
  const width = 132;

  const html = `
    <div style="
      width:${width}px; box-sizing:border-box;
      background:rgba(255,255,255,0.96); backdrop-filter:blur(8px);
      border:1px solid ${spec.selected ? CSS.ink : spec.recommended ? CSS.brand : 'rgba(226,232,240,1)'};
      border-radius:9px; padding:6px 8px; cursor:pointer;
      box-shadow:${spec.selected
        ? '0 0 0 2px rgba(14,27,42,.12), 0 2px 4px rgba(14,27,42,.18), 0 8px 24px rgba(14,27,42,.24)'
        : '0 1px 2px rgba(14,27,42,.16), 0 4px 16px rgba(14,27,42,.20)'};
      font-family:Inter,'Segoe UI',system-ui,sans-serif; line-height:1.25;">
      <div style="display:flex;align-items:center;gap:5px;margin-bottom:3px;">
        <span style="width:7px;height:7px;border-radius:99px;background:${color};flex:0 0 auto;"></span>
        <span style="font-size:11px;font-weight:700;color:${CSS.ink};letter-spacing:-0.01em;">${spec.title}</span>
        ${
          spec.recommended
            ? `<span style="margin-left:auto;font-size:8.5px;font-weight:700;color:${CSS.brand};
                 letter-spacing:.06em;text-transform:uppercase;">Best</span>`
            : ''
        }
      </div>
      <div style="display:flex;align-items:baseline;gap:4px;font-variant-numeric:tabular-nums;">
        <span style="font-size:10px;color:rgb(132,148,165);">Risk</span>
        <span style="font-size:12.5px;font-weight:700;color:${color};">${spec.riskScore}%</span>
        <span style="margin-left:auto;font-size:10px;color:rgb(132,148,165);">ETA</span>
        <span style="font-size:11px;font-weight:600;color:${CSS.ink};">${spec.etaLabel}</span>
      </div>
    </div>`;

  return cachedIcon({
    html,
    className: 'marker-plain',
    iconSize: [width, 44],
    iconAnchor: [width / 2, spec.offsetY ?? 52],
  });
}

// ---------------------------------------------------------------------------
// Place label — a town name on the corridor
// ---------------------------------------------------------------------------

export function placeLabelIcon(name: string): L.DivIcon {
  const html = `
    <div style="
      white-space:nowrap; transform:translateX(-50%);
      font-family:Inter,'Segoe UI',system-ui,sans-serif;
      font-size:10.5px; font-weight:600; letter-spacing:.02em;
      color:#fff; text-shadow:0 1px 3px rgba(14,27,42,.9), 0 0 2px rgba(14,27,42,.8);">
      ${name}
    </div>`;
  return cachedIcon({ html, className: 'marker-plain', iconSize: [0, 0], iconAnchor: [0, -6] });
}

// ---------------------------------------------------------------------------
// Route ribbon styling
// ---------------------------------------------------------------------------

export type RouteKey = 'a' | 'b' | 'c';

export const ROUTE_COLOR: Record<RouteKey, string> = {
  a: 'rgb(var(--route-a))',
  b: 'rgb(var(--route-b))',
  c: 'rgb(var(--route-c))',
};

/**
 * A route is drawn as two stacked polylines: a wide white casing underneath and the coloured
 * core on top. That is how real cartography renders roads, and it is what keeps a red route
 * legible where it crosses a red-brown hillside.
 */
export function routeStyle(key: RouteKey, recommended: boolean, selected = false, dimmed = false) {
  // Emphasis has two independent sources: the model recommends a route, and the operator has
  // one open in the intelligence panel. They are usually the same route but must not be
  // conflated — a selected non-recommended route still has to read as selected.
  //
  // `dimmed` is "another route is selected". The recommendation used to keep its heavy stroke
  // regardless, so selecting Route C while B was recommended left two lines looking selected.
  // When the operator has chosen a route, that route alone is emphasised; the recommendation is
  // still flagged BEST on its callout, it just stops competing for the eye.
  const emphasised = selected || (recommended && !dimmed);
  return {
    casing: {
      color: '#ffffff',
      weight: emphasised ? 10 : 7,
      opacity: selected ? 0.95 : dimmed ? 0.55 : 0.85,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    },
    core: {
      color: ROUTE_COLOR[key],
      weight: emphasised ? 5 : 3.5,
      opacity: selected ? 1 : dimmed ? 0.45 : recommended ? 0.95 : 0.75,
      dashArray: key === 'b' ? undefined : key === 'a' ? '10 7' : '2 8',
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    },
    /** A wide invisible line under both, so the route is clickable without pixel-hunting. */
    hit: {
      color: '#000000',
      weight: 20,
      opacity: 0,
      lineCap: 'round' as const,
      lineJoin: 'round' as const,
    },
  };
}
