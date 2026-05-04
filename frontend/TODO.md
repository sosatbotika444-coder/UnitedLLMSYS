# Frontend Redesign & Architecture Overhaul - United Lane System

## 🎯 Цели
- **Современный UI:** Card-based, minimal, enterprise-grade (Figma/Notion style).
- **Мобильный-first:** Bottom nav, swipe gestures, touch-friendly.
- **State management:** Zustand (global fleet/trips), React Query (API).
- **Design system:** shadcn/ui + Tailwind (замена styles.css).
- **Performance:** Lazy loading, skeletons, virtualization для lists.

## 📦 Dependencies (npm install)
```
tailwindcss postcss autoprefixer
zustand @tanstack/react-query lucide-react
@radix-ui/react-* @headlessui/react
react-hot-toast clsx tailwind-merge
class-variance-authority
```
**tailwind.config.js** + **globals.css**.

## 🏗️ Архитектура (New Structure)
```
src/
├── app/          # Router + Providers
├── components/ui/ # shadcn primitives (Button, Card, Tabs...)
├── lib/          # Utils, hooks, stores
├── stores/       # Zustand (fleetStore, tripStore)
├── queries/      # React Query hooks
├── workspaces/   # FuelService, Safety, Driver
└── hooks/        # useFleet, useTrip...
```

## 📋 Tasks (High → Low Priority)

### [ ] 1. Setup Tailwind + Design System (2h)
- Replace styles.css → Tailwind.
- `npx shadcn-ui@latest init`
- Add Button, Card, Tabs, Dialog, Table.
- Migrate metric cards → shadcn Card.

### [ ] 2. Global State + Providers (3h)
```
stores/fleetStore.js: vehicles, fleetMetrics
stores/tripStore.js: activeTrips, selectedTrip
queries/useFleetQuery.js: api/motive/fleet
```
- App.jsx → Providers (QueryClientProvider, FleetProvider).

### [ ] 3. Mobile-First Layout (4h)
```
Layout.jsx:
- Desktop: Sidebar + Main
- Mobile: BottomNav + FAB "New Load"
```
- Swipe для workspace switch.

### [ ] 4. Global Search (2h)
```
SearchModal.jsx: Cmd+K → unified search (loads/trucks/trips)
```

### [ ] 5. Refactor Workspaces (8h+)
```
Workspaces/FuelService/
├── Dashboard.jsx (metric cards + workflow steps)
├── LoadsBoard.jsx (card grid, not table)
├── Tracking.jsx (fleet map + list)
└── RoutePlanner.jsx (simplified from RouteAssistant)
```

### [ ] 6. Loading + UX Polish (3h)
- Skeleton components.
- react-hot-toast для notifications.
- Keyboard shortcuts (? → help).

### [ ] 7. Migrate Components
```
[x] MotiveDashboardCards → FleetDashboard
[ ] TeamChat → ChatWorkspace
[ ] MotiveTrackingPanel → FleetTracking
[ ] FullRoadWorkspace → TripMonitor (collapsible)
[ ] RouteAssistant → RouteBuilder (filters → chips)
```

## 🎨 Visual Redesign
```
- Cards: shadcn Card (hover shadows, subtle borders)
- Colors: Brand green (#20d18b), blue accents, clean neutrals
- Typography: Inter (system font fallback)
- Spacing: 4px scale (p-1=4px, p-4=16px)
- Icons: Lucide-react (20px, stroke 2)
```

## 🧪 Testing
```
- Storybook для UI components
- Cypress для E2E (load creation → route → track)
- Manual: Mobile Chrome DevTools + Lighthouse
```

## 🚀 Deploy
```
npm run build → dist/
Netlify auto-deploys from main
```

**Dependencies:** No backend changes. Pure frontend refactor.
**Timeline:** 2-3 days для MVP (1-6), +2d polish.

Start with: `npm i tailwindcss...` + `npx shadcn-ui init`

