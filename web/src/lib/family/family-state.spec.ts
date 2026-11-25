import { FamilyState } from '#lib/family/family-state.svelte.ts';
import { FamilyRole } from '@immich/sdk';

const mocks = vi.hoisted(() => ({ getMyFamily: vi.fn() }));
vi.mock('@immich/sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getMyFamily: mocks.getMyFamily,
}));

describe('FamilyState', () => {
  beforeEach(() => mocks.getMyFamily.mockReset());

  it('asks again after a failed request instead of caching the failure', async () => {
    const state = new FamilyState();
    mocks.getMyFamily.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ role: FamilyRole.Member });

    await state.load();
    expect(state.inFamily).toBe(false);
    await state.load();
    expect(state.inFamily).toBe(true);
    expect(state.role).toBe(FamilyRole.Member);
    expect(mocks.getMyFamily).toHaveBeenCalledTimes(2);
  });

  it('loads once while it is known, and shares a request in flight', async () => {
    const state = new FamilyState();
    mocks.getMyFamily.mockResolvedValue({ role: FamilyRole.Admin });
    await Promise.all([state.load(), state.load()]);
    await state.load();
    expect(mocks.getMyFamily).toHaveBeenCalledTimes(1);
  });

  it('invalidate drops a stale role, and a request in flight cannot bring it back', async () => {
    const state = new FamilyState();
    let resolve!: (value: { role: FamilyRole }) => void;
    mocks.getMyFamily.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const loading = state.load();
    state.invalidate();
    resolve({ role: FamilyRole.Admin });
    await loading;
    expect(state.role).toBeNull();

    mocks.getMyFamily.mockResolvedValue({ role: FamilyRole.Viewer });
    await state.refresh();
    expect(state.role).toBe(FamilyRole.Viewer);
    mocks.getMyFamily.mockResolvedValue({ role: FamilyRole.Member });
    await state.refresh();
    expect(state.role).toBe(FamilyRole.Member);
  });
});
