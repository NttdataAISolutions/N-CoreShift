/**
 * N-CoreShift — Global application store
 *
 * Provides in-memory state that survives React Router navigation (tab switching)
 * and is persisted to localStorage so it also survives full page refreshes.
 *
 * Pattern: React Context + useReducer + localStorage hydration.
 * All page components should consume `useAppStore()` instead of keeping their
 * own `useState` for data that must be shared or outlive the component.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useEffect,
  useRef,
} from 'react';
import {
  MOCK_PROJECTS,
  MOCK_LANDSCAPES,
  MOCK_INVENTORY,
  MOCK_ANALYSES,
  type MockProject,
  type MockLandscape,
  type MockInventoryObject,
  type MockAnalysis,
} from '../data/mockData';

// ── Storage key ──────────────────────────────────────────────────────────────

// Bump the version suffix whenever the shape of AppState changes so that
// stale localStorage entries are ignored and the new defaults take effect.
const STORAGE_KEY = 'ncs-app-store-v4';

// ── State shape ──────────────────────────────────────────────────────────────

export interface AppState {
  activeProjectId: string | null;
  projects: MockProject[];
  landscapes: MockLandscape[];
  analyses: MockAnalysis[];
  inventory: MockInventoryObject[];
}

function defaultState(): AppState {
  return {
    activeProjectId: MOCK_PROJECTS[0]?.id ?? null,
    projects: MOCK_PROJECTS,
    landscapes: MOCK_LANDSCAPES,
    analyses: MOCK_ANALYSES,
    inventory: MOCK_INVENTORY,
  };
}

// ── Actions ───────────────────────────────────────────────────────────────────

type Action =
  | { type: 'SET_ACTIVE_PROJECT'; id: string }
  | { type: 'ADD_PROJECT'; project: MockProject }
  | { type: 'UPDATE_PROJECT'; project: MockProject }
  | { type: 'DELETE_PROJECT'; id: string }
  | { type: 'UPDATE_LANDSCAPE'; landscape: MockLandscape }
  | { type: 'ADD_LANDSCAPE'; landscape: MockLandscape }
  | { type: 'RESOLVE_CHECK'; projectId: string; checkId: string }
  | { type: 'ADD_ANALYSIS'; analysis: MockAnalysis }
  | { type: 'UPDATE_ANALYSIS'; analysis: MockAnalysis }
  | { type: 'ADD_OBJECT'; object: MockInventoryObject }
  | { type: 'UPDATE_OBJECT'; object: MockInventoryObject }
  | { type: 'RESET' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProjectId: action.id };

    case 'ADD_PROJECT':
      return {
        ...state,
        projects: [...state.projects, action.project],
        activeProjectId: action.project.id,
      };

    case 'UPDATE_PROJECT':
      return {
        ...state,
        projects: state.projects.map((p) =>
          p.id === action.project.id ? action.project : p,
        ),
      };

    case 'DELETE_PROJECT': {
      const remaining = state.projects.filter((p) => p.id !== action.id);
      const newActive =
        state.activeProjectId === action.id
          ? (remaining[0]?.id ?? null)
          : state.activeProjectId;
      return {
        ...state,
        projects: remaining,
        activeProjectId: newActive,
        landscapes: state.landscapes.filter((l) => l.projectId !== action.id),
        analyses: state.analyses.filter((a) => a.projectId !== action.id),
        inventory: state.inventory.filter((o) => {
          const projectAnalysisIds = state.analyses
            .filter((a) => a.projectId === action.id)
            .map((a) => a.id);
          return !projectAnalysisIds.includes(o.analysisId);
        }),
      };
    }

    case 'UPDATE_LANDSCAPE':
      return {
        ...state,
        landscapes: state.landscapes.map((l) =>
          l.projectId === action.landscape.projectId ? action.landscape : l,
        ),
      };

    case 'ADD_LANDSCAPE':
      return {
        ...state,
        landscapes: [...state.landscapes, action.landscape],
      };

    case 'RESOLVE_CHECK':
      return {
        ...state,
        landscapes: state.landscapes.map((l) =>
          l.projectId === action.projectId
            ? {
                ...l,
                readinessChecks: l.readinessChecks.map((c) =>
                  c.id === action.checkId ? { ...c, status: 'pass' as const } : c,
                ),
              }
            : l,
        ),
      };

    case 'ADD_ANALYSIS':
      return {
        ...state,
        analyses: [...state.analyses, action.analysis],
        projects: state.projects.map((p) =>
          p.id === action.analysis.projectId
            ? { ...p, analysisCount: p.analysisCount + 1 }
            : p,
        ),
      };

    case 'UPDATE_ANALYSIS':
      return {
        ...state,
        analyses: state.analyses.map((a) =>
          a.id === action.analysis.id ? action.analysis : a,
        ),
      };

    case 'ADD_OBJECT':
      return { ...state, inventory: [...state.inventory, action.object] };

    case 'UPDATE_OBJECT':
      return {
        ...state,
        inventory: state.inventory.map((o) =>
          o.id === action.object.id ? action.object : o,
        ),
      };

    case 'RESET':
      return defaultState();

    default:
      return state;
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function loadFromStorage(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as Partial<AppState>;
    // Merge with defaults so new fields added in future releases are present
    return {
      ...defaultState(),
      ...parsed,
    };
  } catch {
    return defaultState();
  }
}

function saveToStorage(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage quota exceeded or private-browsing restriction — degrade silently
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface AppStoreContextValue {
  state: AppState;
  setActiveProject: (id: string) => void;
  addProject: (project: MockProject) => void;
  updateProject: (project: MockProject) => void;
  deleteProject: (id: string) => void;
  updateLandscape: (landscape: MockLandscape) => void;
  addLandscape: (landscape: MockLandscape) => void;
  resolveCheck: (projectId: string, checkId: string) => void;
  addAnalysis: (analysis: MockAnalysis) => void;
  updateAnalysis: (analysis: MockAnalysis) => void;
  addObject: (object: MockInventoryObject) => void;
  updateObject: (object: MockInventoryObject) => void;
  resetStore: () => void;
}

const AppStoreContext = createContext<AppStoreContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AppStoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadFromStorage);

  // Persist every state change to localStorage (debounce not needed at this scale)
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    saveToStorage(state);
  }, [state]);

  const setActiveProject = useCallback((id: string) => {
    dispatch({ type: 'SET_ACTIVE_PROJECT', id });
  }, []);

  const addProject = useCallback((project: MockProject) => {
    dispatch({ type: 'ADD_PROJECT', project });
  }, []);

  const updateProject = useCallback((project: MockProject) => {
    dispatch({ type: 'UPDATE_PROJECT', project });
  }, []);

  const deleteProject = useCallback((id: string) => {
    dispatch({ type: 'DELETE_PROJECT', id });
  }, []);

  const updateLandscape = useCallback((landscape: MockLandscape) => {
    dispatch({ type: 'UPDATE_LANDSCAPE', landscape });
  }, []);

  const addLandscape = useCallback((landscape: MockLandscape) => {
    dispatch({ type: 'ADD_LANDSCAPE', landscape });
  }, []);

  const resolveCheck = useCallback((projectId: string, checkId: string) => {
    dispatch({ type: 'RESOLVE_CHECK', projectId, checkId });
  }, []);

  const addAnalysis = useCallback((analysis: MockAnalysis) => {
    dispatch({ type: 'ADD_ANALYSIS', analysis });
  }, []);

  const updateAnalysis = useCallback((analysis: MockAnalysis) => {
    dispatch({ type: 'UPDATE_ANALYSIS', analysis });
  }, []);

  const addObject = useCallback((object: MockInventoryObject) => {
    dispatch({ type: 'ADD_OBJECT', object });
  }, []);

  const updateObject = useCallback((object: MockInventoryObject) => {
    dispatch({ type: 'UPDATE_OBJECT', object });
  }, []);

  const resetStore = useCallback(() => {
    dispatch({ type: 'RESET' });
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AppStoreContext.Provider
      value={{
        state,
        setActiveProject,
        addProject,
        updateProject,
        deleteProject,
        updateLandscape,
        addLandscape,
        resolveCheck,
        addAnalysis,
        updateAnalysis,
        addObject,
        updateObject,
        resetStore,
      }}
    >
      {children}
    </AppStoreContext.Provider>
  );
}

// ── Consumer hook ─────────────────────────────────────────────────────────────

export function useAppStore(): AppStoreContextValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) {
    throw new Error('useAppStore must be used inside <AppStoreProvider>');
  }
  return ctx;
}
