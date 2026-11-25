import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyService } from 'src/family/family.service.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

const admin = () => AuthFactory.create({ isAdmin: true });

describe(FamilyService.name, () => {
  let sut: FamilyService;
  let mocks: ServiceMocks;

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyService));
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  describe('addMember', () => {
    it('should refuse a family admin who is not a server admin', async () => {
      const auth = AuthFactory.create({ isAdmin: false });
      mocks.family.getMembership.mockResolvedValue({
        familyId: newUuid(),
        clusterGroupId: newUuid(),
        role: FamilyRole.Admin,
      });

      await expect(sut.addMember(auth, { userId: newUuid(), role: FamilyRole.Member })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(mocks.family.addMember).not.toHaveBeenCalled();
      expect(mocks.person.reassignCluster).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    beforeEach(() => {
      mocks.family.getAnyFamily.mockResolvedValue(void 0);
      mocks.user.get.mockResolvedValue({ id: 'u1', email: 'admin@x.test', clusterGroupId: 'cg1' } as never);
    });

    it('stops with a diagnostic when the cluster group is shared with someone outside the family', async () => {
      mocks.family.getClusterOutsiders.mockResolvedValue([
        { id: 'u1', email: 'admin@x.test', name: 'A' },
        { id: 'u2', email: 'outsider@x.test', name: 'B' },
      ] as never);
      const error = await sut.create(admin(), {}).catch((error_) => error_);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.message).toContain('outsider@x.test');
      expect(mocks.family.createFamilyWithAdmin).not.toHaveBeenCalled();
    });

    it('creates the family, its admin and the history in one repository transaction', async () => {
      mocks.family.getClusterOutsiders.mockResolvedValue([{ id: 'u1', email: 'admin@x.test', name: 'A' }] as never);
      mocks.family.createFamilyWithAdmin.mockResolvedValue({ id: newUuid(), name: 'F', clusterGroupId: 'cg1' } as never);
      mocks.family.getFamily.mockResolvedValue({ id: 'f', name: 'F', wordmark: null } as never);
      mocks.family.getMembers.mockResolvedValue([]);
      await sut.create(admin(), {});
      expect(mocks.family.createFamilyWithAdmin).toHaveBeenCalledTimes(1);
      expect(mocks.family.addMember).not.toHaveBeenCalled();
    });

    it('does not fail the request, or block a retry, when the follow-up sharing fails', async () => {
      mocks.family.getClusterOutsiders.mockResolvedValue([] as never);
      mocks.family.createFamilyWithAdmin.mockResolvedValue({ id: newUuid(), name: 'F', clusterGroupId: 'cg1' } as never);
      mocks.family.ensurePartnerMesh.mockRejectedValue(new Error('boom'));
      mocks.family.getFamily.mockResolvedValue({ id: 'f', name: 'F', wordmark: null } as never);
      mocks.family.getMembers.mockResolvedValue([]);
      await expect(sut.create(admin(), {})).resolves.toBeDefined();
    });
  });

  describe('membership changes', () => {
    const familyId = newUuid();
    const adminAuth = AuthFactory.create({ isAdmin: true });
    beforeEach(() => {
      mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Admin });
      mocks.family.getFamily.mockResolvedValue({ id: familyId, name: 'F', wordmark: null } as never);
      mocks.family.getMembers.mockResolvedValue([]);
    });

    it('refuses to demote the last admin (decided under the family lock)', async () => {
      mocks.family.changeMemberRole.mockResolvedValue({ result: 'last-admin' });
      await expect(sut.updateMember(adminAuth, newUuid(), { role: FamilyRole.Member })).rejects.toThrow(
        'at least one admin',
      );
      expect(mocks.family.ensureAlbumUsers).not.toHaveBeenCalled();
    });

    it('refuses to remove the last admin and changes nothing else', async () => {
      mocks.family.removeMemberChecked.mockResolvedValue({ result: 'last-admin' });
      await expect(sut.removeMember(adminAuth, newUuid())).rejects.toThrow('at least one admin');
      expect(mocks.clusterGroup.create).not.toHaveBeenCalled();
    });

    it('moves a removed member to a cluster group of their own', async () => {
      const userId = newUuid();
      mocks.family.removeMemberChecked.mockResolvedValue({ result: 'removed', role: FamilyRole.Member });
      mocks.clusterGroup.create.mockResolvedValue({ id: 'new-group' } as never);
      await sut.removeMember(adminAuth, userId);
      expect(mocks.person.reassignCluster).toHaveBeenCalledWith({ userId, newClusterId: 'new-group' });
    });

    it('adds a member in one transaction and lets a failed follow-up be retried later', async () => {
      const userId = newUuid();
      mocks.family.getMembership.mockResolvedValueOnce(void 0);
      mocks.user.get.mockResolvedValue({ id: userId, clusterGroupId: 'other' } as never);
      mocks.family.addMemberWithHistory.mockResolvedValue(true);
      mocks.family.ensurePartnerMesh.mockRejectedValue(new Error('boom'));
      await expect(
        sut.addUserToFamily(
          { familyId, clusterGroupId: 'cg', role: FamilyRole.Admin },
          userId,
          FamilyRole.Member,
          { userId: null },
        ),
      ).resolves.toBeUndefined();
      expect(mocks.family.addMember).not.toHaveBeenCalled();
    });

    it('moves a leftover non-member out of the family group at startup', async () => {
      mocks.family.getAnyFamily.mockResolvedValue({ id: familyId, clusterGroupId: 'cg' } as never);
      mocks.family.getClusterOutsiders.mockResolvedValue([{ id: 'u9', email: 'x@y.test', name: 'X' }] as never);
      mocks.clusterGroup.create.mockResolvedValue({ id: 'ng' } as never);
      await sut.onBootstrap();
      expect(mocks.person.reassignCluster).toHaveBeenCalledWith({ userId: 'u9', newClusterId: 'ng' });
    });
  });

  describe('getBranding', () => {
    afterEach(() => {
      delete process.env.IMMICH_FAMILY_APP_URL;
    });

    it('includes where to get the app, when configured', async () => {
      process.env.IMMICH_FAMILY_APP_URL = 'https://apps.apple.com/app/id123';
      mocks.family.getAnyFamily.mockResolvedValue({ wordmark: 'Smiths' } as never);

      await expect(sut.getBranding()).resolves.toEqual({
        wordmark: 'Smiths',
        appUrl: 'https://apps.apple.com/app/id123',
      });
    });

    it('answers with an empty wordmark (stock branding) when the family features are off', async () => {
      delete process.env.IMMICH_FAMILY_ENABLED;
      await expect(sut.getBranding()).resolves.toEqual({ wordmark: '', appUrl: null });
      expect(mocks.family.getAnyFamily).not.toHaveBeenCalled();
    });

    it('has no app link when none is configured', async () => {
      mocks.family.getAnyFamily.mockResolvedValue(void 0);

      await expect(sut.getBranding()).resolves.toEqual({ wordmark: 'sibred', appUrl: null });
    });
  });
});

describe('familyRefuseSharedLinks', () => {
  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('refuses public links when the family archive is on, and does nothing when it is off', async () => {
    const { familyRefuseSharedLinks } = await import('src/family/family-owner-fields.js');
    expect(() => familyRefuseSharedLinks()).not.toThrow();
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    expect(() => familyRefuseSharedLinks()).toThrow('Public sharing is turned off');
  });
});

describe('requireNoFamilyClusterChange', () => {
  const family = { getMembership: vi.fn(), getFamilyByClusterGroup: vi.fn() };
  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    family.getMembership.mockReset();
    family.getFamilyByClusterGroup.mockReset();
  });
  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('refuses members leaving or changing the group, and outsiders joining the family group', async () => {
    const { requireNoFamilyClusterChange } = await import('src/family/family-membership.js');
    family.getMembership.mockResolvedValueOnce({ familyId: 'f' });
    await expect(requireNoFamilyClusterChange(family as never, 'u')).rejects.toThrow('stay in the family');
    family.getMembership.mockResolvedValueOnce(void 0);
    family.getFamilyByClusterGroup.mockResolvedValueOnce({ id: 'f' });
    await expect(requireNoFamilyClusterChange(family as never, 'u', 'cg')).rejects.toThrow('belongs to the family');
    family.getMembership.mockResolvedValueOnce(void 0);
    family.getFamilyByClusterGroup.mockResolvedValueOnce(void 0);
    await expect(requireNoFamilyClusterChange(family as never, 'u', 'cg')).resolves.toBeUndefined();
  });
});
