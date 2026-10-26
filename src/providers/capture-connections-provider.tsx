import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useAuth } from './auth-provider';
type SavedCapture = { userId: string; id: string; updatedAt: string };
const Context = createContext<{ saved: SavedCapture | null; noteSaved: (note: { user_id: string; id: string; updated_at: string }) => void }>({ saved: null, noteSaved: () => {} });
export function CaptureConnectionsProvider({ children }: PropsWithChildren) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const [saved, setSaved] = useState<SavedCapture | null>(null);
  const noteSaved = useCallback((note: { user_id: string; id: string; updated_at: string }) => {
    if (note.user_id === userId) setSaved({ userId: note.user_id, id: note.id, updatedAt: note.updated_at });
  }, [userId]);
  useEffect(() => { if (!saved) return; const timer = setTimeout(() => setSaved(null), 600000); return () => clearTimeout(timer); }, [saved]);
  const value = useMemo(() => ({ saved: saved?.userId === userId ? saved : null, noteSaved }), [saved, userId, noteSaved]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export const useCaptureConnections = () => useContext(Context);
