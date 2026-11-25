import { familyFlagWarning, isFamilyEnabled } from 'src/family/family.flag.js';

describe('family flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('is off in unit tests unless a test switches it on', () => {
    expect(isFamilyEnabled()).toBe(false);
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(isFamilyEnabled()).toBe(true);
  });

  it('is always on outside tests, whatever the variable says', () => {
    vi.stubEnv('VITEST', '');
    expect(isFamilyEnabled()).toBe(true);
    process.env.IMMICH_FAMILY_ENABLED = 'false';
    expect(isFamilyEnabled()).toBe(true);
    expect(familyFlagWarning()).toContain('ignored');
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(familyFlagWarning()).toBeNull();
    delete process.env.IMMICH_FAMILY_ENABLED;
    expect(familyFlagWarning()).toBeNull();
  });
});
