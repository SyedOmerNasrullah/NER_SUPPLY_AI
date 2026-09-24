/**
 * The design system's public surface.
 *
 * Features import from here, never from the individual files, so a primitive can be moved or
 * split without touching a page. Nothing outside `design/` may import lucide-react or Radix
 * directly — the icon vocabulary and the overlay behaviour are the design system's to decide.
 */

export { Panel, PanelHeader, PanelFrame, PanelFooter, PanelSection } from './Panel';
export type { PanelProps, PanelHeaderProps, PanelVariant } from './Panel';

export { MetricValue, Delta, StatTile, StatRow } from './Stat';
export type { MetricValueProps, DeltaProps, StatTileProps } from './Stat';

export {
  Chip,
  RiskChip,
  SeverityChip,
  ScoreChip,
  StockoutChip,
  SegmentStatusChip,
  DeliveryStatusChip,
  PriorityChip,
  StatusDot,
  LiveDot,
  ProvenanceTag,
} from './Chips';
export type { ChipProps, RiskChipProps, StatusDotProps } from './Chips';

export { ProgressBar, FactorBar, FactorBreakdown, Meter, Legend, SectionLabel } from './Bars';
export type { ProgressBarProps, FactorBarProps, LegendItem } from './Bars';

export { RadialGauge, Sparkline, RiskBarCell } from './Gauges';
export type { RadialGaugeProps, SparklineProps } from './Gauges';

export { DataTable, CellStack, CellCode, CellChevron } from './DataTable';
export type { Column, DataTableProps } from './DataTable';

export { AlertRow } from './AlertRow';
export type { AlertRowProps } from './AlertRow';

export { Timeline } from './Timeline';
export type { TimelineProps, TimelineStep, StepState } from './Timeline';

export {
  Skeleton,
  SkeletonText,
  SkeletonRows,
  SkeletonTile,
  SkeletonPane,
  EmptyState,
  ErrorState,
  Async,
} from './States';
export type { EmptyStateProps, ErrorStateProps } from './States';

export {
  Button,
  IconButton,
  Toolbar,
  ToolbarDivider,
  SegmentedControl,
  Tabs,
  TabPanel,
} from './Controls';
export type { ButtonProps, IconButtonProps, SegmentedOption, TabItem } from './Controls';

export { Modal, SidePanel, Callout } from './Overlays';
export type { ModalProps, SidePanelProps } from './Overlays';

export { Icon, IconBadge, ICONS } from '../icons';
export type { IconName, IconSize, IconBadgeTone } from '../icons';
