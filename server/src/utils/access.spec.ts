import { ForbiddenException } from '@nestjs/common';
import { Permission } from 'src/enum.js';
import { checkAccess, checkPersonAccess, requireAccess } from 'src/utils/access.js';
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
    it("should let a family member add another member's photo to an album", async () => {
      const access = newAccessRepositoryMock();
      access.asset.checkPartnerAccess.mockResolvedValue(new Set([assetId]));

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetShare, ids })).resolves.toEqual(
        ids,
      );
    });
  });

  describe('read access to archived and live family photos', () => {
    it.each([Permission.AssetRead, Permission.AssetView, Permission.AssetDownload])(
      'should let any member %s a family photo the stock partner check denies',
      async (permission) => {
        const access = newAccessRepositoryMock();
        access.family.checkAssetReadAccess.mockResolvedValue(new Set([assetId]));

        await expect(checkAccess(access as never, { auth, permission, ids })).resolves.toEqual(ids);
        expect(access.family.checkAssetReadAccess).toHaveBeenCalledWith(auth.user.id, ids);
      },
    );

    it('should not ask the family again for photos the stock checks already allow', async () => {
      const access = newAccessRepositoryMock();
      access.asset.checkOwnerAccess.mockResolvedValue(ids);

      await checkAccess(access as never, { auth, permission: Permission.AssetView, ids });
      expect(access.family.checkAssetReadAccess).not.toHaveBeenCalled();
    });

    it('should let a member read the edits of a family photo', async () => {
      const access = newAccessRepositoryMock();
      access.family.checkAssetReadAccess.mockResolvedValue(ids);

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetEditGet, ids })).resolves.toEqual(
        ids,
      );
    });
  });

  describe('image edits', () => {
    it.each([Permission.AssetEditCreate, Permission.AssetEditDelete])(
      'should keep %s with the owner, whatever the family grants',
      async (permission) => {
        const access = newAccessRepositoryMock();
        access.family.checkAssetEditAccess.mockResolvedValue(ids);
        access.family.checkAssetReadAccess.mockResolvedValue(ids);

        await expect(checkAccess(access as never, { auth, permission, ids, familyGrant: true })).resolves.toEqual(
          new Set(),
        );
      },
    );
  });

  describe(Permission.AssetDelete, () => {
    it('should keep deleting and restoring owner-only unless the caller opts in', async () => {
      const access = newAccessRepositoryMock();
      access.family.checkAssetTrashAccess.mockResolvedValue(ids);

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetDelete, ids })).resolves.toEqual(
        new Set(),
      );
      expect(access.family.checkAssetTrashAccess).not.toHaveBeenCalled();
    });

    it('should let an admin trash another member photo when the caller opts in', async () => {
      const access = newAccessRepositoryMock();
      access.family.checkAssetTrashAccess.mockResolvedValue(ids);

      await expect(
        checkAccess(access as never, { auth, permission: Permission.AssetDelete, ids, familyGrant: true }),
      ).resolves.toEqual(ids);
    });
  });

  describe('family viewers', () => {
    const viewerWrites = [
      Permission.AssetUpdate,
      Permission.AssetDelete,
      Permission.AssetUpload,
      Permission.AssetCopy,
      Permission.AssetEditCreate,
      Permission.AssetEditDelete,
      Permission.AssetFileDelete,
      Permission.FaceDelete,
      Permission.PersonCreate,
      Permission.PersonReassign,
      Permission.StackUpdate,
      Permission.TagAsset,
    ];

    it.each(viewerWrites)('should refuse %s even on a photo the viewer owns', async (permission) => {
      const access = newAccessRepositoryMock();
      access.family.isViewer.mockResolvedValue(true);
      access.asset.checkOwnerAccess.mockResolvedValue(ids);
      access.assetFile.checkOwnerAccess.mockResolvedValue(ids);
      access.person.checkFaceOwnerAccess.mockResolvedValue(ids);
      access.stack.checkOwnerAccess.mockResolvedValue(ids);
      access.tag.checkOwnerAccess.mockResolvedValue(ids);
      access.activity.checkOwnerAccess.mockResolvedValue(ids);

      await expect(checkAccess(access as never, { auth, permission, ids, familyGrant: true })).resolves.toEqual(
        new Set(),
      );
    });

    it('should still let the owner write when they are not a viewer', async () => {
      const access = newAccessRepositoryMock();
      access.family.isViewer.mockResolvedValue(false);
      access.asset.checkOwnerAccess.mockResolvedValue(ids);

      await expect(checkAccess(access as never, { auth, permission: Permission.AssetDelete, ids })).resolves.toEqual(
        ids,
      );
    });

    it('should let a viewer comment (album activity), the one thing viewers write', async () => {
      const access = newAccessRepositoryMock();
      access.family.isViewer.mockResolvedValue(true);
      access.activity.checkOwnerAccess.mockResolvedValue(ids);

      await expect(checkAccess(access as never, { auth, permission: Permission.ActivityDelete, ids })).resolves.toEqual(
        ids,
      );
    });

    it('should tell the viewer why', async () => {
      const access = newAccessRepositoryMock();
      access.family.isViewer.mockResolvedValue(true);
      access.asset.checkOwnerAccess.mockResolvedValue(ids);

      await expect(requireAccess(access as never, { auth, permission: Permission.AssetUpdate, ids })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should keep reading, downloading and adding family photos to albums', async () => {
      const access = newAccessRepositoryMock();
      access.family.isViewer.mockResolvedValue(true);
      access.asset.checkPartnerAccess.mockResolvedValue(ids);
      access.asset.checkOwnerAccess.mockResolvedValue(new Set());
      access.album.checkOwnerAccess.mockResolvedValue(ids);

      for (const permission of [Permission.AssetRead, Permission.AssetDownload, Permission.AssetShare]) {
        await expect(checkAccess(access as never, { auth, permission, ids })).resolves.toEqual(ids);
      }
      await expect(
        checkAccess(access as never, { auth, permission: Permission.AlbumAssetCreate, ids }),
      ).resolves.toEqual(ids);
    });

    it('should refuse viewers merging and deleting people', async () => {
      const access = newAccessRepositoryMock();
      access.family.isViewer.mockResolvedValue(true);
      access.person.checkAccess.mockResolvedValue(new Set([{ personGroupId: assetId, ownerId: auth.user.id }]));
      const personIds = new Set([{ personGroupId: assetId, ownerId: auth.user.id }]);

      for (const permission of [Permission.PersonDelete, Permission.PersonMerge]) {
        await expect(checkPersonAccess(access as never, { auth, permission, ids: personIds })).resolves.toEqual(
          new Set(),
        );
      }
      await expect(
        checkPersonAccess(access as never, { auth, permission: Permission.PersonRead, ids: personIds }),
      ).resolves.toEqual(new Set(personIds));
    });
  });
});
