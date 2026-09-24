# NER-SupplyAI — Frontend

React + Vite + TypeScript + Tailwind. Phase 2 (foundation) is complete; the nine module pages
are built in Phase 3.

```bash
npm install
npm run dev          # http://localhost:5173
npm run typecheck
npm run build
```

Demo accounts (password `demo123`): `admin@ner.local`, `logistics@ner.local`,
`field@ner.local`, `district@ner.local`. Each lands on the first module its role can open.

**`/kitchen-sink`** is the design-system reference — every shared primitive in the states the
product actually uses. It is outside the shell and outside the module list, so it never appears
in navigation.

## Layout

```
src/
  app/         router, auth, module table + role matrix, route guards
  shell/       TopBar · ModuleTabs · HeroBand · StatusRail · UserMenu · BrandMark
  design/      tokens.css, icons, primitives/   ← the design system
  domain/      types (contract §3), thresholds (contract §2), format, geo
  data/        source.ts (interface) · demo/ · http/ · hooks
  map/         MapCanvas, basemaps, markers
  pages/       Login, ModulePlaceholder (Phase 3 replaces), KitchenSink
  assets/      corridor photography — see ATTRIBUTION.md
```

## The rules that keep this coherent

1. **`data/index.ts` is the only module that knows which adapter is live.** Components import
   hooks; hooks import `dataSource`. Nothing imports `data/demo` or `data/http` directly. That
   is what makes Phase 6 an env-var flip (`VITE_DATA_SOURCE=demo|http`) rather than a rewrite.
2. **`domain/types.ts` is a transcription of `PROJECT_CONTRACT.md` §3.** It is edited only after
   `docs/CONTRACT_DELTAS.md` records the change and the contract itself is amended.
3. **`domain/thresholds.ts` is the only place bucket boundaries exist.** No feature re-derives a
   threshold or hardcodes a colour for a domain state.
4. **Nothing outside `design/` imports lucide-react or Radix.**
5. **A feature may not import another feature.** Shared UI is promoted into
   `design/primitives`.
6. **No `Math.random()`, and no `Date.now()` in fixture values.** The demo world is anchored to
   a fixed instant in `data/demo/clock.ts` so `resetDemo()` is byte-reproducible.

See `docs/DESIGN_SYSTEM.md` for the visual contract.
