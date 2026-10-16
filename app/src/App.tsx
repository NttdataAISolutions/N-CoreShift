/**
 * N-CoreShift – Application root
 * Phase 1: Shell, authentication boundary, RBAC, full navigation
 */
import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { TenantProvider } from './auth/TenantContext';
import { NCSPermission, NCS_PERMISSION } from './auth/types';
import { AppStoreProvider, useAppStore } from './store/AppStoreContext';
import AnonymousTestBanner from './components/AnonymousTestBanner';
import './App.css';

// ── Lazy-loaded pages ────────────────────────────────────────────────────────
const HomePage = lazy(() => import('./pages/HomePage'));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage'));
const LandscapePage = lazy(() => import('./pages/LandscapePage'));
const AnalysesPage = lazy(() => import('./pages/AnalysesPage'));
const ObjectInventoryPage = lazy(() => import('./pages/ObjectInventoryPage'));
const ModernizationPlansPage = lazy(() => import('./pages/ModernizationPlansPage'));
const GeneratedArtifactsPage = lazy(() => import('./pages/GeneratedArtifactsPage'));
const AdministrationPage = lazy(() => import('./pages/AdministrationPage'));
const ObjectDetailPage = lazy(() => import('./pages/ObjectDetailPage'));

// ── Navigation definition ────────────────────────────────────────────────────
interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  /** Permission required to see this item; undefined = visible to all authenticated users */
  requiredPermission?: NCSPermission;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: '\u{1F3E0}', end: true },
  { to: '/projects', label: 'Projects', icon: '\u{1F4C1}' },
  { to: '/landscape', label: 'Landscape', icon: '\u{1F30D}' },
  { to: '/object-inventory', label: 'Object Inventory', icon: '\u{1F4CB}' },
  { to: '/analyses', label: 'Analyses', icon: '\u{1F52C}' },
  { to: '/modernization-plans', label: 'Plans', icon: '\u{1F5FA}\uFE0F' },
  { to: '/generated-artifacts', label: 'Artifacts', icon: '\u2699\uFE0F' },
  {
    to: '/administration',
    label: 'Admin',
    icon: '\u{1F527}',
    requiredPermission: NCS_PERMISSION.MANAGE_PLATFORM,
  },
];

// ── Project Selector ─────────────────────────────────────────────────────────
function ProjectSelector() {
  const { state, setActiveProject } = useAppStore();
  const navigate = useNavigate();
  const { projects, activeProjectId } = state;

  if (projects.length === 0) return null;

  const activeProject = projects.find((p) => p.id === activeProjectId);

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const id = e.target.value;
    if (id === '__new__') {
      navigate('/projects');
      return;
    }
    setActiveProject(id);
  }

  return (
    <div className="ncs-nav__project-selector">
      <span className="ncs-nav__project-label">Project:</span>
      <select
        className="ncs-nav__project-select"
        value={activeProjectId ?? ''}
        onChange={handleChange}
        title={activeProject?.name}
      >
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name.length > 28 ? p.name.slice(0, 26) + '…' : p.name}
          </option>
        ))}
        <option value="__new__">＋ New project…</option>
      </select>
    </div>
  );
}

// ── NavBar ───────────────────────────────────────────────────────────────────
function NavBar() {
  const { user, can, signOut } = useAuth();

  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.requiredPermission || can(item.requiredPermission),
  );

  return (
    <nav className="ncs-nav">
      <span className="ncs-nav__brand">
        <span className="ncs-nav__brand-icon">{'\u{1F504}'}</span>
        N-CoreShift
      </span>
      <ul className="ncs-nav__links">
        {visibleItems.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                isActive ? 'ncs-nav__link ncs-nav__link--active' : 'ncs-nav__link'
              }
            >
              <span className="ncs-nav__icon">{item.icon}</span>
              <span className="ncs-nav__label">{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
      <div className="ncs-nav__right">
        <ProjectSelector />
        <div className="ncs-nav__user">
          <span
            className="ncs-nav__user-name"
            title={`Roles: ${(user?.roles ?? []).join(', ')}`}
          >
            {'\u{1F464}'} {user?.name ?? user?.id ?? 'User'}
          </span>
          <button className="ncs-nav__logout" onClick={signOut} type="button">
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}

// ── Route guard ──────────────────────────────────────────────────────────────
interface ProtectedRouteProps {
  permission?: NCSPermission;
  children: React.ReactNode;
}

function ProtectedRoute({ permission, children }: ProtectedRouteProps) {
  const { isAuthenticated, can } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
  }
  if (permission && !can(permission)) {
    return (
      <main className="ncs-page">
        <div className="ncs-status-banner ncs-status-banner--error">
          <strong>Access denied.</strong> You do not have the required permission to view this
          page.
        </div>
      </main>
    );
  }
  return <>{children}</>;
}

// ── Page loading fallback ────────────────────────────────────────────────────
function PageLoader() {
  return (
    <main className="ncs-page">
      <p className="ncs-loading">Loading…</p>
    </main>
  );
}

// ── Authenticated shell ───────────────────────────────────────────────────────
function AuthenticatedShell() {
  const { user } = useAuth();
  const tenantId = user!.tenantId;

  return (
    <TenantProvider tenantId={tenantId}>
      <AppStoreProvider>
        <NavBar />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/projects"
              element={
                <ProtectedRoute>
                  <ProjectsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/landscape"
              element={
                <ProtectedRoute>
                  <LandscapePage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/analyses"
              element={
                <ProtectedRoute>
                  <AnalysesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/object-inventory"
              element={
                <ProtectedRoute>
                  <ObjectInventoryPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/object-inventory/:id"
              element={
                <ProtectedRoute>
                  <ObjectDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/modernization-plans"
              element={
                <ProtectedRoute>
                  <ModernizationPlansPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/generated-artifacts"
              element={
                <ProtectedRoute>
                  <GeneratedArtifactsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/administration"
              element={
                <ProtectedRoute permission={NCS_PERMISSION.MANAGE_PLATFORM}>
                  <AdministrationPage />
                </ProtectedRoute>
              }
            />
            {/* Fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </AppStoreProvider>
    </TenantProvider>
  );
}

// ── App root ──────────────────────────────────────────────────────────────────
function AppShell() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <main className="ncs-page">
        <div className="ncs-status-banner ncs-status-banner--info">Authenticating…</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="ncs-page">
        <div className="ncs-status-banner ncs-status-banner--error">
          Authentication required. Please sign in.
        </div>
      </main>
    );
  }

  return <AuthenticatedShell />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AnonymousTestBanner />
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  );
}
