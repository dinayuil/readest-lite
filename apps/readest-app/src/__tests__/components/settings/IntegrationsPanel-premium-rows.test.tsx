// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserPlan } from '@/types/quota';

/**
 * #7755: opening a Premium cloud-sync row while signed out went to /user,
 * which showed "Loading profile..." for a second before bouncing to /auth.
 * A signed-out reader now goes straight to sign-in; a signed-in free one
 * still gets the plans page.
 */

const push = vi.fn();
const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
// FORK (ACCOUNTLESS_BUILD): tests default to the official build; the fork
// regression block flips this on.
const fork = vi.hoisted(() => ({ accountless: false }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService: { isDesktopApp: true, isMacOSApp: true } }),
}));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: auth.user }) }));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string, o?: Record<string, unknown>) =>
    s.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(o?.[k] ?? '')),
}));
vi.mock('@/hooks/useQuotaStats', () => ({
  useQuotaStats: () => ({ userProfilePlan: 'free', customizationPurchased: false }),
}));
vi.mock('@/utils/access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/access')>();
  return {
    ...actual,
    get ACCOUNTLESS_BUILD() {
      return fork.accountless;
    },
    // Official mode keeps the premium paywall these upstream tests assert; the
    // accountless build ungates third-party cloud sync.
    isCloudSyncAllowed: (plan: UserPlan, customizationPurchased: boolean) =>
      fork.accountless || actual.isCloudSyncInPlan(plan, customizationPurchased),
  };
});
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: {},
    requestedSubPage: null,
    setRequestedSubPage: vi.fn(),
  }),
}));
vi.mock('@/services/sync/dataFlow/connectors', () => ({ getFlowConnectors: () => [] }));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@/app/opds/components/CatalogManager', () => ({ CatalogManager: () => null }));
// The fork regression opens a provider's config sub-page, which mounts its
// form; stub each form so this test stays about where a click routes.
vi.mock('@/components/settings/integrations/WebDAVForm', () => ({
  default: () => <div data-testid='webdav-form' />,
}));
vi.mock('@/components/settings/integrations/GoogleDriveForm', () => ({
  default: () => <div data-testid='gdrive-form' />,
}));
vi.mock('@/components/settings/integrations/S3Form', () => ({
  default: () => <div data-testid='s3-form' />,
}));
vi.mock('@/components/settings/integrations/OneDriveForm', () => ({
  default: () => <div data-testid='onedrive-form' />,
}));
vi.mock('@/components/settings/integrations/ICloudForm', () => ({
  default: () => <div data-testid='icloud-form' />,
}));

import IntegrationsPanel from '@/components/settings/IntegrationsPanel';

const premiumRows = ['Google Drive', 'WebDAV', 'S3 Storage', 'OneDrive', 'iCloud'];

afterEach(() => {
  cleanup();
  push.mockClear();
  auth.user = null;
  fork.accountless = false;
});

describe('IntegrationsPanel premium cloud-sync rows', () => {
  it.each(premiumRows)('opens sign-in directly for %s when signed out', (title) => {
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: title }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatch(/^\/auth\?redirect=/);
  });

  it.each(premiumRows)('opens the plans page for %s on a free plan', (title) => {
    auth.user = { id: 'u1' };
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: title }));
    expect(push).toHaveBeenCalledTimes(1);
    expect(push.mock.calls[0]![0]).toMatch(/^\/user\?redirect=/);
  });
});

// FORK (ACCOUNTLESS_BUILD): third-party cloud sync has no premium gate — the
// plan cannot be known without an account — so a signed-out reader opens the
// provider's own settings instead of being sent to /auth or /user.
describe('IntegrationsPanel premium cloud-sync rows (accountless build)', () => {
  const formTestId: Record<string, string> = {
    'Google Drive': 'gdrive-form',
    WebDAV: 'webdav-form',
    'S3 Storage': 's3-form',
    OneDrive: 'onedrive-form',
    iCloud: 'icloud-form',
  };

  it.each(premiumRows)('opens %s settings for a signed-out reader', (title) => {
    fork.accountless = true;
    render(<IntegrationsPanel />);
    fireEvent.click(screen.getByRole('button', { name: title }));
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId(formTestId[title]!)).toBeTruthy();
  });
});
