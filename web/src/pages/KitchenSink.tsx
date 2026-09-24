/**
 * /kitchen-sink — the design system's reference page.
 *
 * A development surface, but held to the same standard as the product: if the primitives cannot
 * be assembled into something that looks finished here, they will not look finished on the
 * Command Center either. This page is the Phase 2 acceptance test.
 *
 * It is deliberately outside the AppShell and outside the module list, so it never appears in
 * navigation and can be reviewed full-bleed.
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { formatDuration, formatStockout } from '@/domain/format';
import { CORRIDOR_WAYPOINTS, type LatLng } from '@/domain/geo';
import type { Provenance, RiskLevel } from '@/domain/types';
import {
  DELIVERY_SUCCESS_HISTORY,
  DISTRICTS,
  FACTORS_AFTER_RAIN,
  INCIDENTS,
  ROUTE_SPECS,
  SEGMENTS,
  VEHICLES,
  BASELINE_ALERTS,
  CASCADE_ALERTS,
  WAREHOUSES,
} from '@/data/demo/fixtures';
import {
  AlertRow,
  Button,
  Callout,
  Chip,
  Column,
  DataTable,
  CellCode,
  CellStack,
  Delta,
  DeliveryStatusChip,
  EmptyState,
  ErrorState,
  FactorBreakdown,
  Icon,
  IconBadge,
  IconButton,
  Legend,
  Meter,
  MetricValue,
  Modal,
  Panel,
  PanelFooter,
  PanelFrame,
  PanelHeader,
  PanelSection,
  PriorityChip,
  ProgressBar,
  ProvenanceTag,
  RadialGauge,
  RiskBarCell,
  RiskChip,
  ScoreChip,
  SectionLabel,
  SegmentStatusChip,
  SegmentedControl,
  SidePanel,
  Skeleton,
  SkeletonRows,
  SkeletonTile,
  Sparkline,
  StatRow,
  StatTile,
  StatusDot,
  StockoutChip,
  Tabs,
  TabPanel,
  Timeline,
  Toolbar,
  ToolbarDivider,
  type IconName,
} from '@/design/primitives';
import { MapCanvas, type MapRoute } from '@/map/MapCanvas';
import { BrandLockup } from '@/shell/BrandMark';
import { HeroBand, ImagePanel } from '@/shell/HeroBand';
import ridgeline from '@/assets/ner-ridgeline.jpg';
import corridorRoad from '@/assets/ner-corridor-road.jpg';

const SECTIONS = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'status', label: 'Status & chips' },
  { id: 'bars', label: 'Bars & SHAP' },
  { id: 'gauges', label: 'Gauges' },
  { id: 'tables', label: 'Tables' },
  { id: 'alerts', label: 'Alerts & timeline' },
  { id: 'controls', label: 'Controls' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'states', label: 'States' },
  { id: 'icons', label: 'Icons' },
  { id: 'map', label: 'Map' },
];

export function KitchenSink() {
  const [modalOpen, setModalOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [tab, setTab] = useState('overview');
  const [range, setRange] = useState<'7d' | '14d' | '30d'>('14d');

  const routes = useMemo<MapRoute[]>(() => {
    const keys = ['a', 'b', 'c'] as const;
    return ROUTE_SPECS.map((spec, i) => ({
      id: spec.id,
      key: keys[i],
      name: `Route ${keys[i].toUpperCase()}`,
      geometry: spec.geometry,
      riskScore: spec.afterRain.riskScore,
      etaMinutes: spec.afterRain.etaMinutes,
      recommended: keys[i] === 'b',
      showCallout: true,
      flowing: keys[i] === 'a',
    }));
  }, []);

  const places = useMemo(
    () =>
      [0, 9, 15].map((i) => ({
        name: CORRIDOR_WAYPOINTS[i].name,
        position: [CORRIDOR_WAYPOINTS[i].lat, CORRIDOR_WAYPOINTS[i].lng] as LatLng,
      })),
    [],
  );

  const successValues = DELIVERY_SUCCESS_HISTORY.map((d) => d.successRatePct);
  const delayValues = DELIVERY_SUCCESS_HISTORY.map((d) => d.avgDelayMin);

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground">
      {/* ------------------------------------------------------------- Header */}
      <header className="flex h-chrome shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
        <BrandLockup />
        <span className="h-7 w-px shrink-0 bg-line" aria-hidden />
        <div className="flex min-w-0 flex-col leading-none">
          <span className="truncate text-[12.5px] font-semibold text-ink">Design system reference</span>
          <span className="mt-[3px] truncate text-[10.5px] text-ink-3">
            Every shared primitive, in the states the product actually uses
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Chip tone="brand" icon="layers">
            Phase 2
          </Chip>
          <Link to="/" className="btn btn-secondary btn-sm">
            <Icon name="arrowRight" size="sm" />
            Open the console
          </Link>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* ----------------------------------------------------------- Side nav */}
        <nav className="hidden w-[188px] shrink-0 overflow-y-auto scroll-thin border-r border-line bg-panel px-2 py-3 lg:block">
          <p className="t-label px-2 pb-2">Sections</p>
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-body text-ink-2 transition-colors duration-150 ease-ui hover:bg-panel-alt hover:text-ink"
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* ------------------------------------------------------------ Content */}
        <main className="min-h-0 flex-1 overflow-y-auto scroll-thin">
          <div className="mx-auto flex max-w-[1180px] flex-col gap-8 p-5 pb-20">
            {/* ============================================== Foundations ==== */}
            <Section id="foundations" title="Foundations" hint="Colour, type and geometry tokens">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <PanelFrame header={<PanelHeader title="Surfaces & ink" icon="layers" />}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Swatch name="ground" hex="#F2F5F8" className="bg-ground" />
                    <Swatch name="panel" hex="#FFFFFF" className="bg-panel" />
                    <Swatch name="panel-alt" hex="#F7F9FB" className="bg-panel-alt" />
                    <Swatch name="line" hex="#E2E8F0" className="bg-line" />
                    <Swatch name="ink" hex="#0E1B2A" className="bg-ink" dark />
                    <Swatch name="ink-2" hex="#516070" className="bg-ink-2" dark />
                    <Swatch name="ink-3" hex="#8494A5" className="bg-ink-3" dark />
                    <Swatch name="brand-50" hex="#E8F2F9" className="bg-brand-50" />
                  </div>

                  <SectionLabel rule className="mt-4">
                    Brand
                  </SectionLabel>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Swatch name="brand-900" hex="#0A3A5C" className="bg-brand-900" dark />
                    <Swatch name="brand-700" hex="#0B5C8F" className="bg-brand-700" dark />
                    <Swatch name="brand-500" hex="#1276B8" className="bg-brand-500" dark />
                    <Swatch name="brand-200" hex="#AFD1E8" className="bg-brand-200" />
                  </div>

                  <SectionLabel rule className="mt-4">
                    Risk · bound to contract §2 thresholds
                  </SectionLabel>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Swatch name="CRITICAL" hex="85–100" className="bg-risk-critical" dark />
                    <Swatch name="HIGH" hex="70–84" className="bg-risk-high" dark />
                    <Swatch name="MEDIUM" hex="40–69" className="bg-risk-medium" dark />
                    <Swatch name="LOW" hex="0–39" className="bg-risk-low" dark />
                  </div>

                  <PanelFooter className="-mx-4 -mb-4 mt-4">
                    Four risk colours, three route colours, one brand blue. Anything outside that
                    list is a bug, not a decision.
                  </PanelFooter>
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Type scale" icon="analytics" />}>
                  <div className="flex flex-col divide-y divide-line-soft">
                    <TypeRow label="display · 32/37" className="font-display text-display">
                      Command Center
                    </TypeRow>
                    <TypeRow label="display-sm · 24/29" className="font-display text-display-sm">
                      Route Intelligence
                    </TypeRow>
                    <TypeRow label="title · 17/23" className="text-title">
                      Delivery NE-102
                    </TypeRow>
                    <TypeRow label="section · 15/21" className="text-section">
                      Priority Alerts
                    </TypeRow>
                    <TypeRow label="body · 13/19" className="text-body text-ink-2">
                      Heavy rainfall and landslide history drive the risk.
                    </TypeRow>
                    <TypeRow label="meta · 11.5/16" className="text-meta text-ink-3">
                      Projected stockout in 32 hours · updated 5 min ago
                    </TypeRow>
                    <TypeRow label="label · 11 uppercase" className="t-label">
                      Disruption risk
                    </TypeRow>
                    <TypeRow label="metric · 27 tabular">
                      <span className="flex items-baseline gap-3">
                        <MetricValue value={87} unit="%" animate={false} />
                        <MetricValue value={6.55} decimals={2} unit="h" animate={false} />
                        <MetricValue value={1200} unit="units" size="sm" animate={false} />
                      </span>
                    </TypeRow>
                  </div>
                  <PanelFooter className="-mx-4 -mb-4 mt-3">
                    Inter for UI, Inter Tight for display. Every figure is tabular so a tweening
                    metric never jitters.
                  </PanelFooter>
                </PanelFrame>
              </div>
            </Section>

            {/* ================================================= Surfaces ==== */}
            <Section
              id="surfaces"
              title="Surfaces"
              hint="Five panel variants, so the product is not a field of identical white cards"
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                <PanelFrame header={<PanelHeader title="default" subtitle="The standard raised surface" icon="layers" />}>
                  <p className="text-body text-ink-2">
                    White, 1px hairline, 10px radius, a shadow soft enough that ten of them on one
                    screen do not read as clutter.
                  </p>
                </PanelFrame>

                <PanelFrame variant="sunk" header={<PanelHeader title="sunk" subtitle="A recessed well" icon="database" />}>
                  <p className="text-body text-ink-2">
                    For charts, readouts and anything that should read as inset rather than raised.
                  </p>
                </PanelFrame>

                <PanelFrame
                  variant="navy"
                  header={<PanelHeader title="navy" subtitle="Institutional identity" icon="risk" onNavy />}
                >
                  <p className="text-body text-white/75">
                    Deep navy with a contour texture. Used for identity blocks and map side rails,
                    never for ordinary content.
                  </p>
                </PanelFrame>

                <Panel variant="bare" className="min-h-[152px] border border-line shadow-panel">
                  <ImagePanel
                    image={corridorRoad}
                    title="Stronger Supply Chains"
                    subtitle="A More Resilient North East"
                    credit="Kingshuk Mondal, CC BY 4.0"
                    className="-m-4 h-[calc(100%+32px)]"
                    footer={
                      <div className="flex items-center gap-2 text-[11px] text-white/70">
                        <span>People</span>
                        <span className="opacity-40">·</span>
                        <span>Connectivity</span>
                        <span className="opacity-40">·</span>
                        <span>Opportunity</span>
                      </div>
                    }
                  />
                </Panel>

                <div className="relative min-h-[152px] overflow-hidden rounded-panel border border-line">
                  <img src={ridgeline} alt="" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-3">
                    <Panel variant="float" className="w-full">
                      <p className="t-label mb-1">float</p>
                      <p className="text-meta text-ink-2">
                        Translucent, blurred, heavier shadow. The only variant that sits directly on
                        the map.
                      </p>
                    </Panel>
                  </div>
                </div>

                <PanelFrame
                  header={<PanelHeader title="flush + footer" subtitle="Sections without more boxes" icon="supply" />}
                  flushBody
                >
                  <div className="flex flex-col gap-3 p-4">
                    <PanelSection label="Medicine">
                      <StatRow label="Current stock" value="420 units" />
                      <StatRow label="Consumption" value="13 / day" />
                      <StatRow label="Stockout in" value="32h" emphasis />
                    </PanelSection>
                  </div>
                  <PanelFooter>
                    <ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />
                  </PanelFooter>
                </PanelFrame>
              </div>
            </Section>

            {/* ================================================== Metrics ==== */}
            <Section id="metrics" title="Metrics" hint="Stat tiles, values and deltas — the top strip">
              <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-3 2xl:grid-cols-6">
                <StatTile label="Active Deliveries" value={24} icon="deliveries" tone="brand" delta={{ value: 8, goodDirection: 'up' }} footnote="3 at risk" />
                <StatTile label="At-Risk Deliveries" value={6} icon="warning" tone="critical" accent="critical" delta={{ value: 50, goodDirection: 'down' }} footnote="2 critical" />
                <StatTile label="Road Blockages" value={3} icon="blockage" tone="high" footnote="1 major · 2 minor" />
                <StatTile label="Critical Supply Alerts" value={4} icon="supply" tone="medium" footnote="2 districts" />
                <StatTile
                  label="Field Officers Active"
                  value={18}
                  icon="operations"
                  tone="neutral"
                  valueNode={
                    <span className="flex items-baseline gap-1">
                      <MetricValue value={18} />
                      <span className="text-metric-sm text-ink-3">/ 24</span>
                    </span>
                  }
                  footnote="75% in field"
                />
                <StatTile
                  label="Average Delay (Today)"
                  value={72}
                  icon="prediction"
                  tone="low"
                  valueNode={<span className="t-metric">{formatDuration(72)}</span>}
                  delta={{ value: -23, goodDirection: 'down' }}
                />
              </div>

              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                <PanelFrame header={<PanelHeader title="MetricValue sizes" icon="prediction" />}>
                  <div className="flex flex-col gap-3">
                    <div className="flex items-baseline gap-2">
                      <MetricValue value={87} unit="%" size="lg" className="text-risk-critical" />
                      <span className="t-label">lg</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <MetricValue value={32} unit="%" size="md" className="text-brand-700" />
                      <span className="t-label">md</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                      <MetricValue value={1200} unit="units" size="sm" />
                      <span className="t-label">sm</span>
                    </div>
                  </div>
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Delta direction" icon="up" />}>
                  <div className="flex flex-col gap-2.5">
                    <StatRow label="Success rate +4%" value={<Delta value={4} goodDirection="up" />} />
                    <StatRow label="At-risk +50%" value={<Delta value={50} goodDirection="down" />} />
                    <StatRow label="Avg delay −23%" value={<Delta value={-23} goodDirection="down" />} />
                    <StatRow label="No change" value={<Delta value={0} />} />
                  </div>
                  <p className="mt-3 text-[10.5px] leading-relaxed text-ink-3">
                    A rise is not always good. `goodDirection` decides the colour, so the arrows
                    never contradict the meaning.
                  </p>
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Trend" icon="analytics" actions={<SegmentedControl size="sm" options={[{ value: '7d', label: '7d' }, { value: '14d', label: '14d' }, { value: '30d', label: '30d' }]} value={range} onChange={setRange} />} />}>
                  <div className="flex flex-col gap-3">
                    <div>
                      <p className="t-label mb-1">Delivery success rate</p>
                      <div className="flex items-end gap-3">
                        <MetricValue value={91.4} decimals={1} unit="%" size="sm" />
                        <Sparkline values={successValues} width={150} height={38} color="rgb(var(--risk-low))" />
                      </div>
                    </div>
                    <div>
                      <p className="t-label mb-1">Average delay</p>
                      <div className="flex items-end gap-3">
                        <MetricValue value={72} unit="min" size="sm" />
                        <Sparkline values={delayValues} width={150} height={38} color="rgb(var(--risk-high))" />
                      </div>
                    </div>
                  </div>
                </PanelFrame>
              </div>
            </Section>

            {/* =================================================== Status ==== */}
            <Section id="status" title="Status & chips" hint="Every one resolves its colour through domain/thresholds">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
                <PanelFrame header={<PanelHeader title="Risk & severity" icon="risk" />}>
                  <PanelSection label="Wash (default)">
                    <div className="flex flex-wrap gap-1.5">
                      {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).map((l) => (
                        <RiskChip key={l} level={l} />
                      ))}
                    </div>
                  </PanelSection>
                  <PanelSection label="Solid" className="mt-3">
                    <div className="flex flex-wrap gap-1.5">
                      {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).map((l) => (
                        <RiskChip key={l} level={l} emphasis="solid" />
                      ))}
                    </div>
                  </PanelSection>
                  <PanelSection label="With score" className="mt-3">
                    <div className="flex flex-wrap gap-1.5">
                      {[87, 72, 43, 21].map((s) => (
                        <ScoreChip key={s} score={s} />
                      ))}
                    </div>
                  </PanelSection>
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Domain states" icon="deliveries" />}>
                  <PanelSection label="Delivery status">
                    <div className="flex flex-wrap gap-1.5">
                      <DeliveryStatusChip status="IN_TRANSIT" />
                      <DeliveryStatusChip status="AT_RISK" />
                      <DeliveryStatusChip status="PENDING" />
                      <DeliveryStatusChip status="DELIVERED" />
                      <DeliveryStatusChip status="FAILED" />
                    </div>
                  </PanelSection>
                  <PanelSection label="Segment · priority · stockout" className="mt-3">
                    <div className="flex flex-wrap gap-1.5">
                      <SegmentStatusChip status="OPEN" />
                      <SegmentStatusChip status="PARTIAL" />
                      <SegmentStatusChip status="BLOCKED" />
                      <PriorityChip priority="CRITICAL" />
                      <StockoutChip hours={32} />
                      <StockoutChip hours={72} />
                      <StockoutChip hours={130} />
                      <StockoutChip hours={null} />
                    </div>
                  </PanelSection>
                  <PanelSection label="Dots" className="mt-3">
                    <div className="flex flex-wrap items-center gap-4">
                      <StatusDot level="LOW" pulse label="live" />
                      <StatusDot level="MEDIUM" label="degraded" />
                      <StatusDot level="CRITICAL" label="offline" />
                    </div>
                  </PanelSection>
                </PanelFrame>

                <PanelFrame
                  header={<PanelHeader title="Provenance" subtitle="Synthetic is never shown as measured" icon="database" />}
                >
                  <ul className="flex flex-col gap-2">
                    {(
                      [
                        'SYNTHETIC_HISTORICAL',
                        'SYNTHETIC_OPERATIONAL',
                        'SIMULATION_EVENT',
                        'ML_PREDICTION',
                        'LLM_EXPLANATION',
                        'EXTERNAL_API',
                      ] as Provenance[]
                    ).map((p) => (
                      <li key={p} className="flex items-center justify-between gap-3 border-b border-line-soft pb-2 last:border-b-0 last:pb-0">
                        <ProvenanceTag kind={p} />
                        <code className="text-[10px] text-ink-3">{p}</code>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[10.5px] leading-relaxed text-ink-3">
                    Deliberately quiet — a panel footer marker, not a badge on every value. Hover
                    for the full explanation.
                  </p>
                </PanelFrame>
              </div>
            </Section>

            {/* ===================================================== Bars ==== */}
            <Section id="bars" title="Bars & SHAP" hint="The most important graphic in the product">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_1fr]">
                <PanelFrame
                  header={
                    <PanelHeader
                      title="Risk Factors (SHAP)"
                      subtitle="Bhalukpong – Tenga Valley, after simulated rainfall"
                      icon="explanation"
                      badge={<ScoreChip score={87} size="sm" />}
                      actions={<ProvenanceTag kind="ML_PREDICTION" />}
                    />
                  }
                >
                  <FactorBreakdown factors={FACTORS_AFTER_RAIN} level="CRITICAL" />

                  <Callout tone="brand" icon="ai" title="Why this route is risky" className="mt-4">
                    Heavy rainfall, poor road condition and historical landslide zones are the main
                    contributors to the elevated risk for Route A.
                  </Callout>
                  <div className="mt-2 flex justify-end">
                    <ProvenanceTag kind="LLM_EXPLANATION" />
                  </div>
                </PanelFrame>

                <div className="flex flex-col gap-3">
                  <PanelFrame header={<PanelHeader title="ProgressBar" icon="prediction" />}>
                    <div className="flex flex-col gap-3">
                      <LabeledBar label="Route A" value={87} />
                      <LabeledBar label="Route C" value={64} />
                      <LabeledBar label="Route B" value={32} />
                      <div>
                        <div className="mb-1 flex items-baseline justify-between">
                          <span className="t-label">Stock vs 48h safety line</span>
                          <span className="tnum text-meta text-ink-2">{formatStockout(32)}</span>
                        </div>
                        <ProgressBar value={32} level="CRITICAL" size="lg" marker={48} markerLabel="48h safety line" />
                      </div>
                    </div>
                  </PanelFrame>

                  <PanelFrame header={<PanelHeader title="Meter & Legend" icon="supply" />}>
                    <Meter label="Tawang · medicine" value={420} max={1200} unit=" units" level="CRITICAL" marker={40} markerLabel="Safety stock" />
                    <SectionLabel rule className="mt-4">
                      Legend
                    </SectionLabel>
                    <Legend
                      className="mt-2"
                      items={[
                        { label: 'Recommended', color: 'rgb(var(--route-b))', style: 'solid' },
                        { label: 'High risk', color: 'rgb(var(--route-a))', style: 'dashed' },
                        { label: 'Alternative', color: 'rgb(var(--route-c))', style: 'dashed' },
                        { label: 'Incident', color: 'rgb(var(--risk-critical))', style: 'dot' },
                      ]}
                    />
                  </PanelFrame>
                </div>
              </div>
            </Section>

            {/* =================================================== Gauges ==== */}
            <Section id="gauges" title="Gauges" hint="Hand-drawn SVG, not a charting library">
              <PanelFrame header={<PanelHeader title="RadialGauge, Sparkline, RiskBarCell" icon="prediction" />}>
                <div className="flex flex-wrap items-center gap-8">
                  <RadialGauge value={87} label="Disruption risk" size={132} />
                  <RadialGauge value={32} label="Route B" size={110} />
                  <RadialGauge value={72} label="Segment" size={92} thickness={8} />
                  <RadialGauge value={21} label="At rest" size={92} thickness={8} />

                  <div className="flex min-w-[190px] flex-col gap-2.5">
                    <p className="t-label">Risk bar cells</p>
                    {[87, 72, 58, 43, 21].map((s) => (
                      <RiskBarCell key={s} score={s} />
                    ))}
                  </div>
                </div>
              </PanelFrame>
            </Section>

            {/* =================================================== Tables ==== */}
            <Section id="tables" title="Tables" hint="Typed columns, 40px rows, contained horizontal scroll">
              <div className="grid grid-cols-1 gap-3 2xl:grid-cols-2">
                <PanelFrame
                  flushBody
                  header={
                    <PanelHeader
                      title="Supply Status (Critical Districts)"
                      icon="supply"
                      actions={<Button variant="ghost" size="sm" iconRight="arrowRight">View All</Button>}
                    />
                  }
                >
                  <DataTable
                    // Sorted by urgency rather than sliced, so the sample shows all three
                    // stockout states instead of five identical STABLE rows.
                    rows={[...DISTRICTS]
                      .sort(
                        (a, b) =>
                          (a.stock.medicine.predictedStockoutHours ?? 1e9) -
                          (b.stock.medicine.predictedStockoutHours ?? 1e9),
                      )
                      .slice(0, 5)}
                    rowKey={(d) => d.id}
                    onRowClick={() => setPanelOpen(true)}
                    columns={
                      [
                        { key: 'district', header: 'District', render: (d) => <CellStack primary={d.name} /> },
                        { key: 'cat', header: 'Category', render: () => <span className="text-ink-2">Medicine</span> },
                        { key: 'stock', header: 'Current Stock', numeric: true, render: (d) => d.stock.medicine.currentStock.toLocaleString('en-IN') },
                        { key: 'cons', header: 'Consumption', numeric: true, render: (d) => `${d.stock.medicine.dailyConsumption}/day` },
                        { key: 'out', header: 'Stockout In', numeric: true, render: (d) => <span className="font-semibold">{formatStockout(d.stock.medicine.predictedStockoutHours)}</span> },
                        { key: 'status', header: 'Status', align: 'right', render: (d) => <StockoutChip hours={d.stock.medicine.predictedStockoutHours} /> },
                      ] as Column<(typeof DISTRICTS)[number]>[]
                    }
                  />
                </PanelFrame>

                <PanelFrame
                  flushBody
                  header={<PanelHeader title="Segments by current risk" icon="risk" badge={<Chip tone="neutral" size="sm">15</Chip>} />}
                >
                  <DataTable
                    striped
                    rows={[...SEGMENTS].sort((a, b) => b.lastRiskScore - a.lastRiskScore).slice(0, 5)}
                    rowKey={(s) => s.id}
                    rowAccent={(s) =>
                      s.lastRiskScore >= 70 ? 'bg-risk-high' : s.lastRiskScore >= 40 ? 'bg-risk-medium' : 'bg-risk-low'
                    }
                    columns={
                      [
                        { key: 'code', header: 'Segment', render: (s) => <CellStack primary={<CellCode>{s.code}</CellCode>} secondary={s.name} /> },
                        { key: 'status', header: 'Status', render: (s) => <SegmentStatusChip status={s.currentStatus} /> },
                        { key: 'risk', header: 'Risk', align: 'right', width: '160px', render: (s) => <RiskBarCell score={s.lastRiskScore} width={80} className="justify-end" /> },
                      ] as Column<(typeof SEGMENTS)[number]>[]
                    }
                  />
                </PanelFrame>
              </div>
            </Section>

            {/* =================================================== Alerts ==== */}
            <Section id="alerts" title="Alerts & timeline" hint="The priority feed, and the cascade as a chain">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_1fr]">
                <PanelFrame
                  flushBody
                  scroll
                  header={<PanelHeader title="Priority Alerts" icon="alert" actions={<Button variant="ghost" size="sm" iconRight="arrowRight">View All</Button>} />}
                >
                  {[...CASCADE_ALERTS, ...BASELINE_ALERTS].map((a) => (
                    <AlertRow key={a.id} alert={a} onClick={() => undefined} />
                  ))}
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Cascade" subtitle="One weather event, five consequences" icon="simulate" />}>
                  <Timeline
                    steps={[
                      { id: '1', title: 'Simulated heavy rainfall applied', detail: 'Rainfall 1h 4.2 → 24.6 mm', meta: '10:24', state: 'done', icon: 'simulate' },
                      { id: '2', title: 'Route risk recalculated', detail: 'SEG-010 Bhalukpong – Tenga Valley 43 → 87', meta: '+44', state: 'done' },
                      { id: '3', title: 'Delivery delay predicted', detail: 'NE-102 ETA 5h 05m → 7h 20m', meta: '+2h 15m', state: 'done' },
                      { id: '4', title: 'Stockout projection updated', detail: 'Tawang medicine 51h → 32h, below the 48h line', meta: '−19h', state: 'active' },
                      { id: '5', title: 'Decision engine', detail: 'REROUTE + PRE_POSITION', state: 'pending' },
                      { id: '6', title: 'Officer notified', detail: 'Twilio rejected the message at the provider', state: 'failed' },
                    ]}
                  />

                  <SectionLabel rule className="mt-5">
                    Track variant
                  </SectionLabel>
                  <Timeline
                    className="mt-3"
                    variant="track"
                    steps={[
                      { id: 'a', title: 'Guwahati', meta: 'departed', state: 'done' },
                      { id: 'b', title: 'Tezpur', meta: '04:10', state: 'done' },
                      { id: 'c', title: 'Bhalukpong', meta: 'now', state: 'active' },
                      { id: 'd', title: 'Bomdila', meta: '+2h', state: 'pending' },
                      { id: 'e', title: 'Tawang', meta: 'ETA 7h 20m', state: 'pending' },
                    ]}
                  />
                </PanelFrame>
              </div>
            </Section>

            {/* ================================================= Controls ==== */}
            <Section id="controls" title="Controls" hint="Buttons, toolbars, segmented switches, tabs">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                <PanelFrame header={<PanelHeader title="Buttons" icon="settings" />} flushBody>
                  <Toolbar
                    right={
                      <>
                        <IconButton name="filter" label="Filter" />
                        <IconButton name="refresh" label="Refresh" />
                        <ToolbarDivider />
                        <IconButton name="settings" label="Settings" active />
                      </>
                    }
                  >
                    <Button variant="primary" size="sm" icon="simulate">
                      Simulate Heavy Rainfall
                    </Button>
                    <Button variant="secondary" size="sm" icon="add">
                      New Delivery
                    </Button>
                  </Toolbar>

                  <div className="flex flex-col gap-4 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="primary" icon="simulate">Primary</Button>
                      <Button variant="secondary" icon="add">Secondary</Button>
                      <Button variant="ghost" icon="refresh">Ghost</Button>
                      <Button variant="danger" icon="critical">Danger</Button>
                      <Button variant="primary" pending>Running cascade</Button>
                      <Button variant="secondary" disabled icon="notify">Disabled</Button>
                    </div>

                    <div className="surface-navy texture-contour flex flex-wrap items-center gap-2 rounded-panel p-3">
                      <Button variant="on-navy" icon="simulate">On navy</Button>
                      <IconButton name="layers" label="Layers" variant="on-navy" />
                      <SegmentedControl
                        onNavy
                        options={[{ value: 'a', label: 'Map' }, { value: 'b', label: 'Table' }]}
                        value="a"
                        onChange={() => undefined}
                      />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <IconButton name="layers" label="Layers" variant="secondary" />
                      <IconButton name="locate" label="Recentre" variant="float" />
                      <IconButton name="close" label="Close" />
                      <IconButton name="check" label="Acknowledge" active />
                    </div>
                  </div>
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Tabs & fields" icon="layers" />}>
                  <Tabs
                    value={tab}
                    onValueChange={setTab}
                    items={[
                      { value: 'overview', label: 'Overview', icon: 'commandCenter' },
                      { value: 'factors', label: 'Factors', icon: 'explanation' },
                      { value: 'history', label: 'History', icon: 'analytics', badge: <Chip size="sm" tone="neutral">14</Chip> },
                    ]}
                  >
                    <TabPanel value="overview" className="pt-3">
                      <p className="text-body text-ink-2">
                        The active tab is underlined in brand blue, meeting the list's own hairline.
                      </p>
                    </TabPanel>
                    <TabPanel value="factors" className="pt-3">
                      <FactorBreakdown factors={FACTORS_AFTER_RAIN.slice(0, 3)} level="HIGH" />
                    </TabPanel>
                    <TabPanel value="history" className="pt-3">
                      <Sparkline values={successValues} width={260} height={46} />
                    </TabPanel>
                  </Tabs>

                  <SectionLabel rule className="mt-5">
                    Fields
                  </SectionLabel>
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1.5">
                      <label className="t-label" htmlFor="ks-cargo">Cargo type</label>
                      <input id="ks-cargo" className="field" defaultValue="Medicine (Emergency)" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="t-label" htmlFor="ks-priority">Priority</label>
                      <select id="ks-priority" className="field" defaultValue="CRITICAL">
                        <option>CRITICAL</option>
                        <option>HIGH</option>
                        <option>MEDIUM</option>
                        <option>LOW</option>
                      </select>
                    </div>
                  </div>
                </PanelFrame>
              </div>
            </Section>

            {/* ================================================= Overlays ==== */}
            <Section id="overlays" title="Overlays" hint="Modal, side panel and inline callouts">
              <PanelFrame header={<PanelHeader title="Overlays & callouts" icon="layers" />}>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" icon="add" onClick={() => setModalOpen(true)}>Open modal</Button>
                  <Button variant="secondary" icon="supply" onClick={() => setPanelOpen(true)}>Open side panel</Button>
                </div>

                <div className="mt-4 flex flex-col gap-2.5">
                  <Callout tone="brand" icon="ai" title="AI Recommendation" action={<Button variant="primary" size="sm">Use Route B</Button>}>
                    Reroute NE-102 through Route B. Risk falls from 87% to 32% and arrival improves
                    by 25 minutes against the current Route A projection.
                  </Callout>
                  <Callout tone="critical" icon="critical" title="Supply impact">
                    Tawang medicine stock is projected to run out in 32 hours — below the 48-hour
                    safety line.
                  </Callout>
                  <Callout tone="medium" icon="warning" title="Notification not delivered">
                    Twilio rejected the message at the provider. The alert was still created and the
                    cascade completed; the interface reports the notification as failed rather than
                    claiming success.
                  </Callout>
                  <Callout tone="low" icon="ok" title="Corridor clear">
                    No blocked segments on the Guwahati → Tawang corridor.
                  </Callout>
                </div>
              </PanelFrame>
            </Section>

            {/* =================================================== States ==== */}
            <Section id="states" title="States" hint="Loading, empty and error — the states that decide whether a product feels finished">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <PanelFrame header={<PanelHeader title="Skeleton · tiles" icon="spinner" />}>
                  <div className="flex flex-col gap-2.5">
                    <SkeletonTile />
                    <div className="flex gap-2">
                      <Skeleton className="h-9 w-9" />
                      <div className="flex flex-1 flex-col gap-2 pt-1">
                        <Skeleton className="h-2.5 w-3/4" rounded="sm" />
                        <Skeleton className="h-2.5 w-1/2" rounded="sm" />
                      </div>
                    </div>
                  </div>
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Skeleton · rows" icon="spinner" />} flushBody>
                  <SkeletonRows rows={5} />
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Empty · good news" icon="ok" />} flushBody>
                  <EmptyState
                    tone="positive"
                    icon="ok"
                    title="No alerts on the corridor"
                    description="Every monitored segment is open and no delivery is currently flagged at risk."
                    size="sm"
                  />
                </PanelFrame>

                <PanelFrame header={<PanelHeader title="Error · with retry" icon="warning" />} flushBody>
                  <ErrorState
                    size="sm"
                    title="Routing service unavailable"
                    message="No candidate routes could be generated. Nothing was fabricated in place of the real geometry."
                    status={503}
                    onRetry={() => undefined}
                  />
                </PanelFrame>
              </div>
            </Section>

            {/* ==================================================== Icons ==== */}
            <Section id="icons" title="Icons" hint="One concept, one icon — the product's whole vocabulary">
              <PanelFrame header={<PanelHeader title="IconBadge tones & the icon set" icon="layers" />}>
                <div className="flex flex-wrap items-center gap-3">
                  {(['brand', 'neutral', 'critical', 'high', 'medium', 'low'] as const).map((tone) => (
                    <div key={tone} className="flex flex-col items-center gap-1.5">
                      <IconBadge name="risk" tone={tone} size="lg" />
                      <span className="text-[10px] text-ink-3">{tone}</span>
                    </div>
                  ))}
                  <div className="surface-navy flex flex-col items-center gap-1.5 rounded-panel p-2">
                    <IconBadge name="risk" tone="navy" size="lg" />
                    <span className="text-[10px] text-white/60">navy</span>
                  </div>
                </div>

                <SectionLabel rule className="mt-5">
                  Vocabulary
                </SectionLabel>
                <div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 sm:grid-cols-5 xl:grid-cols-8">
                  {(
                    [
                      'commandCenter', 'liveMap', 'deliveries', 'routes', 'incidents', 'risk', 'supply', 'operations',
                      'analytics', 'vehicle', 'warehouse', 'hospital', 'destination', 'medicine', 'food', 'fuel',
                      'officer', 'weather', 'rainfall', 'wind', 'visibility', 'terrain', 'blockage', 'roadblock',
                      'ai', 'model', 'prediction', 'explanation', 'simulate', 'database', 'external', 'notify',
                      'critical', 'warning', 'info', 'ok', 'live', 'alert', 'up', 'down',
                    ] as IconName[]
                  ).map((n) => (
                    <div key={n} className="flex items-center gap-1.5 overflow-hidden">
                      <Icon name={n} size="md" className="text-ink-2" />
                      <span className="truncate text-[10px] text-ink-3">{n}</span>
                    </div>
                  ))}
                </div>
              </PanelFrame>
            </Section>

            {/* ====================================================== Map ==== */}
            <Section id="map" title="Map" hint="One MapCanvas serves Command Center, Live Map, Route Intelligence and Incident Center">
              <PanelFrame
                variant="bare"
                className="h-[540px] border border-line shadow-panel"
                flushBody
                header={
                  <PanelHeader
                    title="Guwahati → Tawang corridor"
                    subtitle="Three route candidates after simulated rainfall, with fleet, incidents and depots"
                    icon="liveMap"
                    actions={<ProvenanceTag kind="SYNTHETIC_OPERATIONAL" />}
                  />
                }
              >
                <MapCanvas
                  routes={routes}
                  vehicles={VEHICLES.filter((v) => v.status === 'IN_TRANSIT')}
                  incidents={INCIDENTS}
                  warehouses={WAREHOUSES}
                  places={places}
                  destinations={[{ id: 'd', name: 'Tawang District Hospital', position: [27.5859, 91.859] }]}
                  origins={[{ id: 'o', name: 'Guwahati', position: [26.1445, 91.7362] }]}
                  riskZones={[
                    { id: 'z1', center: [27.18, 92.47], radiusM: 16000, level: 'CRITICAL', label: 'Landslide zone · Tenga Valley' },
                    { id: 'z2', center: [27.5044, 92.1064], radiusM: 12000, level: 'HIGH', label: 'Snow & closure risk · Sela Pass' },
                  ]}
                  showLayerPanel
                  showLegend
                  fitTo={ROUTE_SPECS[0].geometry}
                  footnote={<ProvenanceTag kind="SIMULATION_EVENT" />}
                />
              </PanelFrame>
            </Section>
          </div>
        </main>
      </div>

      {/* ------------------------------------------------------------ Overlays */}
      <Modal
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Create delivery"
        description="The request body is exactly the seven fields contract §4 specifies."
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button variant="primary" icon="add" onClick={() => setModalOpen(false)}>Create delivery</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label className="t-label" htmlFor="m-cargo">Cargo type</label>
            <input id="m-cargo" className="field" defaultValue="Medicine (Emergency)" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="t-label" htmlFor="m-origin">Origin</label>
            <input id="m-origin" className="field" defaultValue="Guwahati" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="t-label" htmlFor="m-dest">Destination</label>
            <input id="m-dest" className="field" defaultValue="Tawang District Hospital" />
          </div>
        </div>
        <Callout tone="neutral" icon="info" className="mt-4">
          The backend assigns the code, the current ETA and the status itself — the client never
          invents them.
        </Callout>
      </Modal>

      <SidePanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        title="Tawang"
        subtitle="Arunachal Pradesh · district headquarters"
        headerAccessory={<StockoutChip hours={32} />}
        footer={
          <>
            <ProvenanceTag kind="ML_PREDICTION" />
            <Button variant="primary" size="sm" icon="notify" className="ml-auto">
              Notify officer now
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-5">
            <RadialGauge value={32} level="CRITICAL" label="Hours to stockout" unit="h" size={116} />
            <div className="flex flex-1 flex-col gap-1.5">
              <StatRow label="Current stock" value="420 units" />
              <StatRow label="Daily consumption" value="13 / day" />
              <StatRow label="Delay-adjusted" value="−19h" emphasis />
            </div>
          </div>

          <Meter label="Against 48h safety line" value={32} max={96} unit="h" level="CRITICAL" marker={50} />

          <SectionLabel rule>Nearest depots</SectionLabel>
          <ul className="flex flex-col divide-y divide-line-soft">
            {WAREHOUSES.slice(3, 6).map((w) => (
              <li key={w.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name="warehouse" size="sm" className="text-ink-3" />
                  <span className="truncate text-body text-ink">{w.name}</span>
                </span>
                <span className="tnum shrink-0 text-meta text-ink-2">
                  {Math.round(120 + w.lat * 3)} km
                </span>
              </li>
            ))}
          </ul>

          <Callout tone="brand" icon="ai" title="Pre-positioning recommendation">
            Transfer 100 units of medicine from Bomdila Highland Depot. The transfer covers the
            projected shortfall with roughly 9 hours of margin.
          </Callout>
        </div>
      </SidePanel>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  hint,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-4">
      <div className="mb-2.5 flex items-baseline gap-3">
        <h2 className="font-display text-[19px] font-semibold tracking-[-0.02em] text-ink">{title}</h2>
        {hint ? <p className="min-w-0 truncate text-meta text-ink-3">{hint}</p> : null}
        <span className="h-px flex-1 bg-line" />
      </div>
      {children}
    </section>
  );
}

function Swatch({
  name,
  hex,
  className,
  dark = false,
}: {
  name: string;
  hex: string;
  className: string;
  dark?: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-chip border border-line">
      <div className={cn('flex h-12 items-end p-1.5', className)}>
        <span className={cn('text-[9.5px] font-semibold', dark ? 'text-white/80' : 'text-ink-3')}>
          {hex}
        </span>
      </div>
      <div className="bg-panel px-1.5 py-1">
        <span className="text-[10px] font-medium text-ink-2">{name}</span>
      </div>
    </div>
  );
}

function TypeRow({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4 py-2">
      <span className="w-[132px] shrink-0 text-[10px] uppercase tracking-[0.05em] text-ink-3">
        {label}
      </span>
      <span className={cn('min-w-0 truncate', className)}>{children}</span>
    </div>
  );
}

function LabeledBar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="t-label">{label}</span>
        <ScoreChip score={value} size="sm" />
      </div>
      <ProgressBar value={value} byScore size="md" />
    </div>
  );
}

function HeroPreview() {
  return <HeroBand image={ridgeline} title="Preview" />;
}
void HeroPreview;
