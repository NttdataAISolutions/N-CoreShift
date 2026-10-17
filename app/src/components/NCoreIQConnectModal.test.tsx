/**
 * N-CoreShift — NCoreIQConnectModal object selection tests
 * Gate 0E10-AUTH-R2D-SELECT1
 *
 * Verifies (per gate Section 15):
 *   - Preview rows contain checkboxes.
 *   - Initial selection = 0.
 *   - Import disabled at selection = 0.
 *   - Selecting one object enables Import.
 *   - Button shows 1 selected object.
 *   - Select All works.
 *   - Deselect All returns count to zero.
 *   - Selection resets when a new preview is loaded.
 *
 * All network calls (fetch) are mocked — no live backend required.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { NCoreIQConnectModal } from './NCoreIQConnectModal';
import { AppStoreProvider } from '../store/AppStoreContext';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    headers: new Headers({ 'X-CSRF-Token': 'test-csrf-token' }),
    ...init,
  } as unknown as Response);
}

function makeObjects(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    sap_object_type: 'PROG',
    friendly_type: 'Program',
    object_name: `ZPROG_${i}`,
    package: 'ZTEST',
    description: `Object ${i}`,
  }));
}

function renderModal() {
  return render(
    <AppStoreProvider>
      <NCoreIQConnectModal onClose={() => {}} />
    </AppStoreProvider>,
  );
}

async function driveToPreview(objectCount = 3) {
  renderModal();

  // ── Connection step ──
  const urlInput = screen.getByPlaceholderText('http://localhost:8000');
  fireEvent.change(urlInput, { target: { value: 'http://localhost:8000' } });
  fireEvent.click(screen.getByText('Test Connection'));

  await waitFor(() => screen.getByText('✓ Connected'));
  fireEvent.click(screen.getByText('Next: Browse Packages →'));

  // ── Packages step ──
  const rootPkgInput = screen.getByPlaceholderText('ZNCOREIQ');
  fireEvent.change(rootPkgInput, { target: { value: 'ZTEST' } });
  fireEvent.click(screen.getByText('Browse'));

  await waitFor(() => screen.getByText('ZTEST_PKG'));
  fireEvent.click(screen.getByText('ZTEST_PKG').closest('label')!.querySelector('input')!);

  fireEvent.click(screen.getByText(/Preview 1 Package\(s\)/));

  // ── Preview step ──
  await waitFor(() => screen.getByText(`Selected: 0 of ${objectCount}`));
}

describe('NCoreIQConnectModal — explicit object selection (Gate 0E10-AUTH-R2D-SELECT1)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, opts?: RequestInit) => {
        if (url === '/api/ncoreiq/csrf') {
          return jsonResponse({ success: true });
        }
        if (url === '/api/ncoreiq/ping') {
          return jsonResponse({ connected: true, systemId: 'NC1', client: '800', sapRelease: '752' });
        }
        if (url === '/api/ncoreiq/packages') {
          return jsonResponse({
            packages: [{ package: 'ZTEST_PKG', parent_package: null, description: 'Test pkg', depth: 0 }],
          });
        }
        if (url === '/api/ncoreiq/preview') {
          return jsonResponse({ objects: makeObjects(3) });
        }
        if (url === '/api/ncoreiq/import') {
          return jsonResponse({ jobId: 'job-1', status: 'RUNNING', objectsRequested: 1 });
        }
        return jsonResponse({});
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('renders a checkbox for every preview row', async () => {
    await driveToPreview(3);
    const checkboxes = screen.getAllByRole('checkbox');
    // 3 object rows (Select All / Deselect All are <button>, not checkboxes)
    expect(checkboxes.length).toBe(3);
  });

  it('starts with zero objects selected', async () => {
    await driveToPreview(3);
    expect(screen.getByText('Selected: 0 of 3')).toBeTruthy();
  });

  it('disables the Import button when selection is zero', async () => {
    await driveToPreview(3);
    const importBtn = screen.getByText(/Import 0 Selected Object/);
    expect((importBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables Import and shows count=1 after selecting one object', async () => {
    await driveToPreview(3);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);

    await waitFor(() => screen.getByText('Selected: 1 of 3'));
    const importBtn = screen.getByText(/Import 1 Selected Object/);
    expect((importBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('Select All selects every object', async () => {
    await driveToPreview(3);
    fireEvent.click(screen.getByText('Select All'));

    await waitFor(() => screen.getByText('Selected: 3 of 3'));
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    checkboxes.forEach((cb) => expect(cb.checked).toBe(true));
  });

  it('Deselect All returns selection count to zero', async () => {
    await driveToPreview(3);
    fireEvent.click(screen.getByText('Select All'));
    await waitFor(() => screen.getByText('Selected: 3 of 3'));

    fireEvent.click(screen.getByText('Deselect All'));
    await waitFor(() => screen.getByText('Selected: 0 of 3'));

    const importBtn = screen.getByText(/Import 0 Selected Object/);
    expect((importBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('resets selection to zero when a new preview is loaded', async () => {
    await driveToPreview(3);
    fireEvent.click(screen.getByText('Select All'));
    await waitFor(() => screen.getByText('Selected: 3 of 3'));

    // Navigate back to packages and re-run preview — selection must reset.
    fireEvent.click(screen.getByText('← Back'));
    fireEvent.click(screen.getByText(/Preview 1 Package\(s\)/));

    await waitFor(() => screen.getByText('Selected: 0 of 3'));
  });

  it('sends only the explicitly selected object identifiers on import', async () => {
    await driveToPreview(3);
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // select ZPROG_1 only

    await waitFor(() => screen.getByText('Selected: 1 of 3'));
    fireEvent.click(screen.getByText(/Import 1 Selected Object/));

    await waitFor(() => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const importCall = fetchMock.mock.calls.find((c) => c[0] === '/api/ncoreiq/import');
      expect(importCall).toBeTruthy();
      const body = JSON.parse((importCall![1] as RequestInit).body as string);
      expect(body.objects).toEqual([{ sap_object_type: 'PROG', object_name: 'ZPROG_1' }]);
    });
  });
});
