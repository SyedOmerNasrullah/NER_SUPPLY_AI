/**
 * NER-SupplyAI design system — Tailwind binding.
 *
 * Every colour below resolves to a CSS custom property declared in `src/design/tokens.css`,
 * stored as raw `R G B` channels so Tailwind's `<alpha-value>` opacity modifiers keep working
 * (`bg-panel/60`, `border-ink/10`). tokens.css is the single source of truth; nothing in this
 * file invents a value.
 *
 * Palette discipline (docs/DESIGN_SYSTEM.md): surfaces, ink, one brand blue, four risk colours,
 * three route colours. Anything outside that list is a bug, not a decision.
 */

const ch = (name) => `rgb(var(${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: ch('--ground'),
        panel: ch('--panel'),
        'panel-alt': ch('--panel-alt'),
        'panel-sunk': ch('--panel-sunk'),
        line: ch('--line'),
        'line-soft': ch('--line-soft'),

        ink: {
          DEFAULT: ch('--ink'),
          2: ch('--ink-2'),
          3: ch('--ink-3'),
          inverse: ch('--ink-inverse'),
        },

        brand: {
          900: ch('--brand-900'),
          800: ch('--brand-800'),
          700: ch('--brand-700'),
          500: ch('--brand-500'),
          200: ch('--brand-200'),
          50: ch('--brand-50'),
        },

        risk: {
          critical: ch('--risk-critical'),
          high: ch('--risk-high'),
          medium: ch('--risk-medium'),
          low: ch('--risk-low'),
        },
        'risk-wash': {
          critical: ch('--risk-critical-wash'),
          high: ch('--risk-high-wash'),
          medium: ch('--risk-medium-wash'),
          low: ch('--risk-low-wash'),
        },

        route: {
          a: ch('--route-a'),
          b: ch('--route-b'),
          c: ch('--route-c'),
        },
      },

      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'Segoe UI', 'sans-serif'],
      },

      /**
       * Every integer 0-100 as an opacity step.
       *
       * Tailwind ships a 5-step scale, so `bg-panel/92` matches no utility and is dropped
       * SILENTLY — which is how a translucent floating panel over satellite imagery ends up
       * with no background at all and no error anywhere. The tints this design system uses
       * (12% rings, 18% borders, 92% floating panels) need finer control than 5-point steps,
       * so the scale is filled in rather than every call site being rounded to the nearest 5.
       */
      opacity: Object.fromEntries(
        Array.from({ length: 101 }, (_, i) => [i, String(i / 100)]),
      ),

      fontSize: {
        // Operational density: the body sits at 13px, labels at 11px uppercase.
        label: ['11px', { lineHeight: '14px', letterSpacing: '0.06em', fontWeight: '600' }],
        meta: ['11.5px', { lineHeight: '16px' }],
        body: ['13px', { lineHeight: '19px' }],
        'body-lg': ['14px', { lineHeight: '21px' }],
        title: ['17px', { lineHeight: '23px', letterSpacing: '-0.01em', fontWeight: '600' }],
        section: ['15px', { lineHeight: '21px', letterSpacing: '-0.005em', fontWeight: '600' }],
        'display-sm': ['24px', { lineHeight: '29px', letterSpacing: '-0.02em', fontWeight: '600' }],
        display: ['32px', { lineHeight: '37px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'display-lg': ['40px', { lineHeight: '45px', letterSpacing: '-0.03em', fontWeight: '600' }],
        metric: ['27px', { lineHeight: '31px', letterSpacing: '-0.02em', fontWeight: '600' }],
        'metric-lg': ['36px', { lineHeight: '40px', letterSpacing: '-0.025em', fontWeight: '600' }],
        'metric-sm': ['19px', { lineHeight: '23px', letterSpacing: '-0.015em', fontWeight: '600' }],
      },

      borderRadius: {
        chip: '6px',
        control: '8px',
        panel: '10px',
        pane: '14px',
      },

      boxShadow: {
        // Depth is carried by the 1px border; the shadow only lifts the panel off the ground.
        panel: '0 1px 2px rgb(14 27 42 / 0.05), 0 2px 8px rgb(14 27 42 / 0.04)',
        raised: '0 2px 4px rgb(14 27 42 / 0.06), 0 8px 24px rgb(14 27 42 / 0.08)',
        overlay: '0 4px 12px rgb(14 27 42 / 0.10), 0 16px 48px rgb(14 27 42 / 0.16)',
        // Controls floating directly on the map need to read against satellite imagery.
        float: '0 1px 2px rgb(14 27 42 / 0.16), 0 4px 16px rgb(14 27 42 / 0.20)',
        inset: 'inset 0 1px 2px rgb(14 27 42 / 0.06)',
      },

      spacing: {
        // 4px base. Named steps exist only where the grid needs a non-multiple.
        chrome: '52px', // TopBar height
        tabs: '44px', // ModuleTabs height
        rail: '30px', // StatusRail height
      },

      transitionTimingFunction: {
        // One curve for the whole product. Fast, no bounce.
        ui: 'cubic-bezier(0.2, 0, 0.2, 1)',
      },

      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.98)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: { from: { backgroundPosition: '200% 0' }, to: { backgroundPosition: '-200% 0' } },
        'pulse-ring': {
          '0%': { transform: 'scale(0.85)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 160ms cubic-bezier(0.2,0,0.2,1)',
        'scale-in': 'scale-in 160ms cubic-bezier(0.2,0,0.2,1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.2,0,0.2,1)',
        shimmer: 'shimmer 1.6s linear infinite',
        'pulse-ring': 'pulse-ring 2.2s cubic-bezier(0.2,0,0.2,1) infinite',
      },
    },
  },
  plugins: [],
};
