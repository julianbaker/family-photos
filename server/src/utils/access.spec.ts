import { Permission } from 'src/enum.js';
import { checkAccess } from 'src/utils/access.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newAccessRepositoryMock } from 'test/repositories/access.repository.mock.js';
import { newUuid } from 'test/small.factory.js';

describe('family access grants', () => {
  const auth = AuthFactory.create();
  const assetId = newUuid();
  const ids = new Set([assetId]);

  describe(Permission.AssetUpdate, () => {
    it('should not grant other members photos unless the caller asks for the family grant', async () => {
      const access = newAccessRepositoryMock();
      access.family.checkAssetEditAccess.mockResolvedValue(new Set([assetId]));

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetUpdate, ids })).resolves.toEqual(
        new Set(),
      );
      expect(access.family.checkAssetEditAccess).not.toHaveBeenCalled();
    });

    it('should grant other members photos when the caller asks for the family grant', async () => {
      const access = newAccessRepositoryMock();
      access.family.checkAssetEditAccess.mockResolvedValue(new Set([assetId]));

      await expect(
        checkAccess(access as never, { auth, permission: Permission.AssetUpdate, ids, familyGrant: true }),
      ).resolves.toEqual(ids);
    });
  });

  describe(Permission.AssetShare, () => {
    it('should refuse other members photos for a viewer', async () => {
      const access = newAccessRepositoryMock();
      access.asset.checkPartnerAccess.mockResolvedValue(new Set([assetId]));
      access.family.checkAssetShareBlocked.mockResolvedValue(new Set([assetId]));

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetShare, ids })).resolves.toEqual(
        new Set(),
      );
      expect(access.family.checkAssetShareBlocked).toHaveBeenCalledWith(auth.user.id, ids);
    });

    it('should allow the caller to share their own photos', async () => {
      const access = newAccessRepositoryMock();
      access.asset.checkOwnerAccess.mockResolvedValue(new Set([assetId]));

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetShare, ids })).resolves.toEqual(
        ids,
      );
      expect(access.family.checkAssetShareBlocked).toHaveBeenCalledWith(auth.user.id, new Set());
    });
  });
});
