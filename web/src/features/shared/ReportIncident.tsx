/**
 * Reporting an incident at a place on the map — the one creation path in the product.
 *
 * Incident Center and the Live Map both use this hook, so there is exactly one way an incident
 * comes into existence and one set of rules it follows:
 *
 *   idle ──start()──► picking ──map click──► form ──File report──► POST /api/incidents
 *                        ▲                    │                        │
 *                        └──"Change on map"───┘                        ▼
 *                                                   write → cache cleared → every page refetches
 *
 * What it deliberately does not do is draw the new incident itself. After a successful POST the
 * data layer invalidates its cache and bumps the cascade version, every `useIncidents()` refetches,
 * and the marker appears because the server now returns it — at the latitude and longitude that
 * were persisted. There is no optimistic marker to disagree with the database, nothing to
 * de-duplicate after the refetch, and nothing that survives only in React state.
 *
 * Failure keeps everything: the dialog stays open with the form and the picked location intact,
 * the error is shown, and the same button retries.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { dataSource } from '@/data';
import { useAction } from '@/data/hooks';
import { humanizeEnum } from '@/domain/format';
import type { LatLng } from '@/domain/geo';
import type { IncidentType, Severity, SubmitIncidentResponse } from '@/domain/types';
import { Button, Callout, Chip, IconButton, Modal } from '@/design/primitives';
import type { MapCanvasProps } from '@/map/MapCanvas';

/** The contract's incident types (PROJECT_CONTRACT §1 `IncidentType`), in reporting order. */
const INCIDENT_TYPES: IncidentType[] = ['LANDSLIDE', 'FLOOD', 'DEBRIS', 'DAMAGED_ROAD', 'BLOCKED_ROAD', 'NORMAL'];
const SEVERITIES: Severity[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

type Stage = 'idle' | 'picking' | 'form';

interface FormState {
  type: IncidentType;
  severity: Severity;
  description: string;
  /** Strings, because they are editable inputs; parsed and range-checked on submit. */
  lat: string;
  lng: string;
}

const EMPTY_FORM: FormState = { type: 'LANDSLIDE', severity: 'HIGH', description: '', lat: '', lng: '' };

/** "27.24130° N, 92.40010° E" — hemisphere letters rather than signs, the way a map reads. */
export function formatCoordinates(lat: number, lng: number): string {
  return `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lng).toFixed(5)}° ${lng >= 0 ? 'E' : 'W'}`;
}

function parseCoordinate(raw: string, min: number, max: number): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export interface IncidentReport {
  stage: Stage;
  /** Enter map-picking mode. */
  start: () => void;
  /** Abandon the report entirely — picking, pin and form. */
  cancel: () => void;
  /** Pass straight to `<MapCanvas pick={...} />`. Undefined when idle. */
  pick: MapCanvasProps['pick'];
  /** Render once on the page. */
  dialog: ReactNode;
  /** The post-submit confirmation, or null. Render near the map. */
  notice: ReactNode;
}

export function useIncidentReport(options: {
  /** Called with the server's response after a successful submission. */
  onCreated?: (result: SubmitIncidentResponse) => void;
} = {}): IncidentReport {
  const [stage, setStage] = useState<Stage>('idle');
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pickedOnMap, setPickedOnMap] = useState(false);
  const [lastCreated, setLastCreated] = useState<SubmitIncidentResponse | null>(null);
  const resultRef = useRef<SubmitIncidentResponse | null>(null);
  const onCreatedRef = useRef(options.onCreated);
  onCreatedRef.current = options.onCreated;

  const lat = parseCoordinate(form.lat, -90, 90);
  const lng = parseCoordinate(form.lng, -180, 180);
  const location: LatLng | undefined = lat !== null && lng !== null ? [lat, lng] : undefined;

  const submit = useAction(async () => {
    if (!location) return;
    const data = new FormData();
    data.set('type', form.type);
    data.set('severity', form.severity);
    data.set('description', form.description.trim());
    // The picked point, exactly. No segment is sent: the server derives it from these
    // coordinates, and a client-supplied one would just be a second opinion to reconcile.
    data.set('lat', String(location[0]));
    data.set('lng', String(location[1]));
    resultRef.current = await dataSource.submitIncident(data);
  });

  const start = useCallback(() => {
    setLastCreated(null);
    setStage('picking');
  }, []);

  const cancel = useCallback(() => {
    setStage('idle');
    setForm(EMPTY_FORM);
    setPickedOnMap(false);
  }, []);

  const onPick = useCallback((point: LatLng) => {
    setForm((f) => ({ ...f, lat: String(point[0]), lng: String(point[1]) }));
    setPickedOnMap(true);
    setStage('form');
  }, []);

  // Escape leaves picking mode — the one keyboard exit a crosshair cursor needs.
  useEffect(() => {
    if (stage !== 'picking') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, cancel]);

  const fileReport = useCallback(async () => {
    resultRef.current = null;
    await submit.run();
    const result = resultRef.current;
    // `useAction` reports failure through `submit.error` and resolves either way; only a stored
    // result means the server accepted the report. On failure the dialog stays as it is.
    if (!result) return;
    setLastCreated(result);
    setStage('idle');
    setForm(EMPTY_FORM);
    setPickedOnMap(false);
    onCreatedRef.current?.(result);
  }, [submit]);

  const pick = useMemo<MapCanvasProps['pick']>(
    () =>
      stage === 'idle'
        ? undefined
        : {
            active: stage === 'picking',
            location,
            onPick,
            hint: 'Click the map where the incident is · Esc to cancel',
          },
    // `location` is derived from form.lat/lng; listing them keeps the memo honest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stage, form.lat, form.lng, onPick],
  );

  const latInvalid = form.lat.trim() !== '' && lat === null;
  const lngInvalid = form.lng.trim() !== '' && lng === null;

  const dialog = (
    <Modal
      open={stage === 'form'}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
      title="Report a road incident"
      description="Filed at the location below. A HIGH or CRITICAL report on the corridor re-scores its segment and runs the full cascade."
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="upload"
            pending={submit.pending}
            disabled={!location}
            onClick={() => void fileReport()}
          >
            {submit.pending ? 'Filing report…' : submit.error ? 'Retry' : 'File report'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {/* --- Location ------------------------------------------------------------- */}
        <div className="flex flex-col gap-2 rounded-panel border border-line bg-panel-alt px-3 py-2.5 sm:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <span className="t-label">Incident location</span>
            {location ? (
              <Chip tone={pickedOnMap ? 'brand' : 'neutral'} size="sm" icon={pickedOnMap ? 'check' : 'locate'}>
                {pickedOnMap ? 'Selected on map' : 'Entered manually'}
              </Chip>
            ) : (
              <Chip tone="outline" size="sm" icon="warning">
                No location
              </Chip>
            )}
          </div>
          <p className="tnum text-body font-semibold text-ink" aria-live="polite">
            {location ? formatCoordinates(location[0], location[1]) : 'Choose a point on the map or enter coordinates.'}
          </p>
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-ink-3">Latitude</span>
              <input
                className="field tnum"
                inputMode="decimal"
                value={form.lat}
                aria-invalid={latInvalid}
                onChange={(e) => {
                  setPickedOnMap(false);
                  setForm((f) => ({ ...f, lat: e.target.value }));
                }}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] text-ink-3">Longitude</span>
              <input
                className="field tnum"
                inputMode="decimal"
                value={form.lng}
                aria-invalid={lngInvalid}
                onChange={(e) => {
                  setPickedOnMap(false);
                  setForm((f) => ({ ...f, lng: e.target.value }));
                }}
              />
            </label>
            <Button variant="secondary" size="sm" icon="locate" onClick={() => setStage('picking')}>
              {location ? 'Change on map' : 'Pick on map'}
            </Button>
          </div>
          {latInvalid || lngInvalid ? (
            <p role="alert" className="text-[10.5px] text-risk-critical">
              {latInvalid ? 'Latitude must be between -90 and 90. ' : ''}
              {lngInvalid ? 'Longitude must be between -180 and 180.' : ''}
            </p>
          ) : null}
        </div>

        {/* --- Classification --------------------------------------------------------- */}
        <label className="flex flex-col gap-1.5">
          <span className="t-label">Incident type</span>
          <select
            className="field"
            value={form.type}
            onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as IncidentType }))}
          >
            {INCIDENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {humanizeEnum(t)}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="t-label">Severity</span>
          <select
            className="field"
            value={form.severity}
            onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as Severity }))}
          >
            {SEVERITIES.map((sv) => (
              <option key={sv} value={sv}>
                {sv}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="t-label">Description</span>
          <textarea
            className="field min-h-[76px] resize-y"
            placeholder="What the officer observed on the ground"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
      </div>

      <p className="mt-3 rounded-panel border border-line bg-panel-alt px-3 py-2.5 text-[10.5px] leading-relaxed text-ink-2">
        Photo upload and vision classification are wired to the same endpoint but are not called in
        this build. The road segment is matched from the location: the nearest corridor segment
        within 5 km, or none.
      </p>

      {submit.error ? (
        <p role="alert" className="mt-2 text-meta text-risk-critical">
          The report was not filed: {submit.error.message} Your details are kept — retry when ready.
        </p>
      ) : null}
    </Modal>
  );

  const notice = lastCreated ? (
    <Callout
      tone="low"
      icon="check"
      title={`${humanizeEnum(lastCreated.incident.type)} reported`}
      action={<IconButton name="close" label="Dismiss" size="sm" onClick={() => setLastCreated(null)} />}
    >
      Filed at {formatCoordinates(lastCreated.incident.lat, lastCreated.incident.lng)}.{' '}
      {lastCreated.segmentMatch
        ? `Matched to ${lastCreated.segmentMatch.code} · ${lastCreated.segmentMatch.name} (${lastCreated.segmentMatch.distanceKm} km away).`
        : lastCreated.segmentMatch === null
          ? 'No corridor segment within 5 km — stored at this point without a segment.'
          : ''}
      {lastCreated.cascadeTriggered ? ' The corridor was re-scored.' : ''}
    </Callout>
  ) : null;

  return { stage, start, cancel, pick, dialog, notice };
}

/** The page's entry point: "Report incident", or "Cancel picking" while the map is armed. */
export function ReportIncidentButton({
  report,
  variant = 'secondary',
}: {
  report: IncidentReport;
  variant?: 'secondary' | 'on-navy' | 'primary';
}) {
  return report.stage === 'picking' ? (
    <Button variant={variant} size="sm" icon="close" onClick={report.cancel}>
      Cancel picking
    </Button>
  ) : (
    <Button variant={variant} size="sm" icon="add" onClick={report.start}>
      Report incident
    </Button>
  );
}
