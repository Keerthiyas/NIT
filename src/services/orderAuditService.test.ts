import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAuthToken, orderAuditService, setAuthToken } from './orderAuditService';

describe('orderAuditService (HTTP client & token handling)', () => {
  beforeEach(() => {
    setAuthToken(null);
    vi.restoreAllMocks();
  });

  it('stores bearer token on login and attaches Authorization header on subsequent requests', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/auth/login') {
        return new Response(
          JSON.stringify({
            token: 'tok-abc-123',
            user: {
              id: 'usr-admin',
              username: 'admin',
              fullName: 'Admin',
              email: 'admin@nitt.local',
              role: 'ADMIN',
              isActive: true,
              mustResetPassword: false,
            },
          }),
          { status: 200 }
        );
      }

      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer tok-abc-123');
      return new Response(
        JSON.stringify({
          orderId: 'ord-2026-0142',
          productId: 'prod-mrk-200',
          productName: 'Murukku 200 g',
          unit: 'packets',
          requestedQuantity: 150,
          remainingToFulfill: 150,
          availableFinishedStock: 100,
          shortageQuantity: 50,
          productionRequired: true,
          rawMaterialAvailability: 'SUFFICIENT',
          bomBreakdown: [],
          materialsRequiringPurchase: [],
          checkedAt: '2026-11-25T10:00:00.000Z',
        }),
        { status: 200 }
      );
    });

    vi.stubGlobal('fetch', fetchMock);

    const loginRes = await orderAuditService.login('admin@nitt.local', 'password123');
    expect(loginRes.user.role).toBe('ADMIN');
    expect(getAuthToken()).toBe('tok-abc-123');

    const analysis = await orderAuditService.checkOrderAvailability('ord-2026-0142');
    expect(analysis.shortageQuantity).toBe(50);
    expect(analysis.productionRequired).toBe(true);
  });

  it('surfaces backend JSON error messages on 403/400 responses', async () => {
    setAuthToken('tok-admin');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ error: 'Access denied for role ADMIN.' }), {
          status: 403,
        })
      )
    );

    await expect(orderAuditService.listUsers()).rejects.toThrow(
      /Access denied for role ADMIN/
    );
  });
});
