import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { JobName } from 'src/enum.js';
import { FamilyPeopleService } from 'src/family/family-people.service.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { AuthFactory } from 'test/factories/auth.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyPeopleService.name, () => {
  let sut: FamilyPeopleService;
  let mocks: ServiceMocks;
  const auth = AuthFactory.create();
  const familyId = newUuid();

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyPeopleService));
    mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Admin });
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  it('should look the photo up among the family shared photos only', async () => {
    const assetId = newUuid();
    mocks.family.getFamilyAssetIds.mockResolvedValue(new Set());

    await expect(sut.getComments(auth, assetId)).rejects.toBeInstanceOf(BadRequestException);
    await expect(sut.getAssetPeople(auth, assetId)).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.family.getFamilyAssetIds).toHaveBeenCalledWith(familyId, [assetId]);
    expect(mocks.family.getComments).not.toHaveBeenCalled();
  });

  describe('comments by a viewer', () => {
    const commentId = newUuid();
    const own = { id: commentId, userId: auth.user.id, assetId: newUuid(), text: 'hello' };

    it('refuses a viewer deleting their own comment', async () => {
      mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Viewer });
      mocks.family.getComment.mockResolvedValue(own as never);

      await expect(sut.deleteComment(auth, commentId)).rejects.toBeInstanceOf(ForbiddenException);
      expect(mocks.family.deleteComment).not.toHaveBeenCalled();
    });

    it('does not offer a viewer the delete button', async () => {
      mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Viewer });
      mocks.family.getFamilyAssetIds.mockResolvedValue(new Set([own.assetId]));
      mocks.family.getComments.mockResolvedValue([{ ...own, userName: 'A', createdAt: new Date() }] as never);

      const [comment] = await sut.getComments(auth, own.assetId);
      expect(comment.canDelete).toBe(false);
    });

    it('lets a member delete their own comment', async () => {
      mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Member });
      mocks.family.getComment.mockResolvedValue(own as never);

      await sut.deleteComment(auth, commentId);
      expect(mocks.family.deleteComment).toHaveBeenCalledWith(commentId);
    });

    it('refuses a viewer posting a comment', async () => {
      mocks.family.getMembership.mockResolvedValue({ familyId, clusterGroupId: newUuid(), role: FamilyRole.Viewer });
      await expect(sut.createComment(auth, own.assetId, { text: 'hi' })).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('repairCovers', () => {
    it('forgets a cover whose photo went private, even when there is no replacement, and deletes its crop', async () => {
      mocks.family.clearPrivateCovers.mockResolvedValue(['/thumbs/a/b.jpeg']);
      mocks.family.getPeopleWithoutCover.mockResolvedValue([]);

      await sut.repairCovers(familyId);

      expect(mocks.family.clearPrivateCovers).toHaveBeenCalledWith(familyId, undefined);
      expect(mocks.job.queue).toHaveBeenCalledWith({ name: JobName.FileDelete, data: { files: ['/thumbs/a/b.jpeg'] } });
      expect(mocks.family.setPersonCover).not.toHaveBeenCalled();
    });

    it('clears before choosing a replacement', async () => {
      const order: string[] = [];
      mocks.family.clearPrivateCovers.mockImplementation(() => {
        order.push('clear');
        return Promise.resolve([]);
      });
      mocks.family.getPeopleWithoutCover.mockImplementation(() => {
        order.push('find');
        return Promise.resolve([]);
      });

      await sut.repairCovers(familyId);
      expect(order).toEqual(['clear', 'find']);
    });
  });

  describe('photos leaving the family view', () => {
    it('repairs the covers of the actor family when photos are trashed or deleted', async () => {
      mocks.family.clearPrivateCovers.mockResolvedValue([]);
      mocks.family.getPeopleWithoutCover.mockResolvedValue([]);

      await sut.onAssetTrashAll({ assetIds: ['a'], userId: auth.user.id });
      await sut.onAssetDeleteAll({ assetIds: ['a'], userId: auth.user.id });

      expect(mocks.family.clearPrivateCovers).toHaveBeenCalledTimes(2);
    });
  });

  describe('getThumbnailFallback', () => {
    it('serves only crops the repository vouches for', async () => {
      const personId = newUuid();
      mocks.family.getFamilyThumbnailPath.mockResolvedValue(undefined);

      await expect(sut.getThumbnailFallback(auth, personId)).resolves.toBeUndefined();
      expect(mocks.family.getFamilyThumbnailPath).toHaveBeenCalledWith(familyId, personId);
    });
  });

  describe('requireInvitablePerson', () => {
    const personId = newUuid();
    const person = (values: Record<string, unknown> = {}) => ({
      personGroupId: personId,
      name: 'Ann Smith',
      kind: null,
      hasPetFaces: false,
      linkedUserId: null,
      ...values,
    });

    it('accepts an unlinked person in the family', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person()] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).resolves.toEqual(
        expect.objectContaining({ personGroupId: personId }),
      );
      expect(mocks.family.getFamilyPeople).toHaveBeenCalledWith(familyId);
    });

    it('refuses someone not in the family', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toThrow('Person not found in the family');
    });

    it('refuses a pet, set by hand or found by pet recognition', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person({ kind: 'pet' })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toBeInstanceOf(BadRequestException);

      mocks.family.getFamilyPeople.mockResolvedValue([person({ hasPetFaces: true })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('accepts a person marked as a person even with pet faces', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person({ kind: 'person', hasPetFaces: true })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).resolves.toBeDefined();
    });

    it('refuses a person already linked to an account', async () => {
      mocks.family.getFamilyPeople.mockResolvedValue([person({ linkedUserId: newUuid() })] as never);
      await expect(sut.requireInvitablePerson(familyId, personId)).rejects.toThrow(
        'Ann Smith is already linked to an account',
      );
    });
  });

  describe('linkInvitedMember', () => {
    const membership = { familyId, clusterGroupId: newUuid(), role: FamilyRole.Member };
    const personId = newUuid();
    const userId = newUuid();

    it('links the person and records it in the history', async () => {
      mocks.family.linkUnlinkedFamilyPerson.mockResolvedValue({ personGroupId: personId } as never);

      await expect(sut.linkInvitedMember(membership, personId, userId)).resolves.toBe(true);

      expect(mocks.family.linkUnlinkedFamilyPerson).toHaveBeenCalledWith(familyId, personId, userId);
      expect(mocks.family.addHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          familyId,
          userId,
          entityType: 'person',
          entityId: personId,
          before: { linkedUserId: null },
          after: { linkedUserId: userId },
        }),
      );
    });

    it('leaves a person someone else was linked to alone', async () => {
      mocks.family.linkUnlinkedFamilyPerson.mockResolvedValue(void 0);

      await expect(sut.linkInvitedMember(membership, personId, userId)).resolves.toBe(false);
      expect(mocks.family.addHistory).not.toHaveBeenCalled();
    });
  });
});
