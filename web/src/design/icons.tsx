/**
 * Icon treatment.
 *
 * lucide-react gives 1500 icons at any size and stroke — which is exactly how an interface ends
 * up with 18px and 14px icons at three different stroke weights sitting next to each other. So
 * the raw library is not imported by features. Features import `Icon` and the curated `ICONS`
 * map below, which fixes size and stroke per role.
 *
 * Sizes are chosen so the optical weight matches the text beside them:
 *   sm  14px / 1.75  — inline with 11-13px text, table cells, chips
 *   md  16px / 1.75  — buttons, nav tabs, panel headers
 *   lg  20px / 1.75  — stat tiles, empty states
 *   xl  24px / 1.5   — hero, large affordances (thinner, because it is bigger)
 */

import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  BarChart3,
  Bell,
  Boxes,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleAlert,
  CloudRain,
  Compass,
  Crosshair,
  Database,
  Download,
  Droplets,
  Eye,
  Filter,
  Flame,
  Gauge,
  Hospital,
  Info,
  Layers,
  LifeBuoy,
  LoaderCircle,
  LogOut,
  Map as MapIcon,
  MapPin,
  Menu,
  Mountain,
  Navigation,
  Package,
  Phone,
  Pill,
  Plus,
  RefreshCw,
  Route,
  Search,
  Settings,
  Share2,
  Shield,
  Siren,
  Sparkles,
  Split,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Truck,
  Upload,
  User,
  Users,
  Warehouse,
  Wind,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/cn';

export type IconName = keyof typeof ICONS;

/**
 * The product's icon vocabulary. One concept, one icon, everywhere. Adding a synonym here
 * (a second truck, a third warning) is how an interface stops feeling designed.
 */
export const ICONS = {
  // Navigation / modules
  commandCenter: Compass,
  liveMap: MapIcon,
  deliveries: Truck,
  routes: Route,
  incidents: AlertTriangle,
  risk: Shield,
  supply: Boxes,
  operations: Users,
  analytics: BarChart3,

  // Domain
  vehicle: Truck,
  warehouse: Warehouse,
  hospital: Hospital,
  destination: MapPin,
  medicine: Pill,
  food: Package,
  fuel: Flame,
  officer: User,
  weather: CloudRain,
  rainfall: Droplets,
  wind: Wind,
  visibility: Eye,
  temperature: Thermometer,
  terrain: Mountain,
  blockage: Ban,
  roadblock: Split,

  // AI / model
  ai: Sparkles,
  model: Brain,
  prediction: Gauge,
  explanation: LifeBuoy,
  simulate: Zap,
  database: Database,
  external: Share2,

  // Status
  critical: Siren,
  warning: CircleAlert,
  info: Info,
  ok: CheckCircle2,
  dot: Circle,
  live: Activity,
  alert: Bell,
  notify: Phone,
  up: TrendingUp,
  down: TrendingDown,

  // Controls
  add: Plus,
  close: X,
  check: Check,
  search: Search,
  filter: Filter,
  layers: Layers,
  settings: Settings,
  refresh: RefreshCw,
  spinner: LoaderCircle,
  logout: LogOut,
  menu: Menu,
  upload: Upload,
  download: Download,
  locate: Crosshair,
  navigate: Navigation,
  arrowRight: ArrowRight,
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
} satisfies Record<string, LucideIcon>;

const SIZES = {
  sm: { px: 14, stroke: 1.75 },
  md: { px: 16, stroke: 1.75 },
  lg: { px: 20, stroke: 1.75 },
  xl: { px: 24, stroke: 1.5 },
} as const;

export type IconSize = keyof typeof SIZES;

export interface IconProps {
  name: IconName;
  size?: IconSize;
  className?: string;
  /** Decorative icons are hidden from assistive tech; meaningful ones get a label. */
  label?: string;
}

export function Icon({ name, size = 'md', className, label }: IconProps) {
  const Glyph = ICONS[name];
  const { px, stroke } = SIZES[size];
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={stroke}
      className={cn('shrink-0', className)}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// IconBadge — an icon on a contextual ground
// ---------------------------------------------------------------------------

const BADGE_TONE = {
  brand: 'bg-brand-50 text-brand-700 ring-brand-500/12',
  neutral: 'bg-panel-sunk text-ink-2 ring-ink/[0.06]',
  critical: 'bg-risk-wash-critical text-risk-critical ring-risk-critical/12',
  high: 'bg-risk-wash-high text-risk-high ring-risk-high/12',
  medium: 'bg-risk-wash-medium text-risk-medium ring-risk-medium/15',
  low: 'bg-risk-wash-low text-risk-low ring-risk-low/12',
  navy: 'bg-white/10 text-white ring-white/15 backdrop-blur-sm',
} as const;

export type IconBadgeTone = keyof typeof BADGE_TONE;

const BADGE_SIZE = {
  sm: 'h-7 w-7 rounded-[7px]',
  md: 'h-9 w-9 rounded-[9px]',
  lg: 'h-11 w-11 rounded-[11px]',
} as const;

export interface IconBadgeProps {
  name: IconName;
  tone?: IconBadgeTone;
  size?: keyof typeof BADGE_SIZE;
  className?: string;
}

/**
 * The stat-tile / alert-row icon: a square of tinted ground with a hairline ring. The ring is
 * what stops it reading as a flat coloured blob at small sizes.
 */
export function IconBadge({ name, tone = 'neutral', size = 'md', className }: IconBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center ring-1',
        BADGE_SIZE[size],
        BADGE_TONE[tone],
        className,
      )}
    >
      <Icon name={name} size={size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : 'md'} />
    </span>
  );
}
