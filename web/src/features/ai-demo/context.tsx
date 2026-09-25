/**
 * One demonstration, shared by everything that shows it — delta D60.
 *
 * `useAiDemo` owns real state, so calling it in two components would give the panel and the
 * start button separate machines: pressing start would advance a state the panel never sees.
 * The provider makes it one machine with several views.
 *
 * It sits in the shell, above the router, because the demonstration walks across pages and its
 * step must survive that walk.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { useAiDemo } from './useAiDemo';

type AiDemoValue = ReturnType<typeof useAiDemo>;

const Ctx = createContext<AiDemoValue | null>(null);

export function AiDemoProvider({ children }: { children: ReactNode }) {
  const value = useAiDemo();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAiDemoCtx(): AiDemoValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAiDemoCtx must be used inside <AiDemoProvider>');
  return v;
}
