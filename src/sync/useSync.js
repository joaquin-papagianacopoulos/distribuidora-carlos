import { useApp } from '../hooks/useAppContext';

// useSync ahora es solo un alias para no romper App.js
export const useSync = () => {
  const { syncing, lastSync, syncError: error, syncNote, syncNow } = useApp();
  return { syncing, lastSync, error, syncNote, syncNow };
};
