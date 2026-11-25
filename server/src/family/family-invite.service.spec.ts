import { BadRequestException } from '@nestjs/common';
import { FamilyInviteService } from 'src/family/family-invite.service.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyService } from 'src/family/family.service.js';
import { UserFactory } from 'test/factories/user.factory.js';
import { newUuid } from 'test/small.factory.js';
import { ServiceMocks, newTestService } from 'test/utils.js';

describe(FamilyInviteService.name, () => {
  let sut: FamilyInviteService;
  let mocks: ServiceMocks;

  const loginDetails = { clientIp: '127.0.0.1', deviceOS: '', deviceType: '', isSecure: false, appVersion: null };
  const dto = { token: 'token', email: 'new@example.com', name: 'New', password: 'password' };
  const invite = {
    id: newUuid(),
    familyId: newUuid(),
    clusterGroupId: newUuid(),
    role: FamilyRole.Member,
    maxUses: 1,
    uses: 0,
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    createdById: newUuid(),
  };

  beforeEach(() => {
    process.env.IMMICH_FAMILY_ENABLED = 'true';
    ({ sut, mocks } = newTestService(FamilyInviteService));
    mocks.crypto.hashSha256.mockReturnValue(Buffer.from('hash'));
    mocks.family.getInviteByTokenHash.mockResolvedValue({ ...invite, familyName: 'Family' } as never);
    mocks.family.consumeInvite.mockResolvedValue({ ...invite, uses: 1 } as never);
    mocks.user.getByEmail.mockResolvedValue(void 0);
    mocks.user.getAdmin.mockResolvedValue(UserFactory.create({ isAdmin: true }) as never);
    mocks.clusterGroup.create.mockResolvedValue({ id: newUuid() } as never);
  });

  afterEach(() => {
    delete process.env.IMMICH_FAMILY_ENABLED;
  });

  describe('accept', () => {
    it('should give the use back and remove the account when joining the family fails', async () => {
      const user = UserFactory.create({ email: dto.email });
      mocks.user.create.mockResolvedValue(user as never);
      // adding the account to the family fails: the user can't be loaded
      mocks.family.getMembership.mockResolvedValue(void 0);
      mocks.user.get.mockResolvedValue(void 0);

      await expect(sut.accept(dto, loginDetails)).rejects.toBeInstanceOf(BadRequestException);

      expect(mocks.family.releaseInvite).toHaveBeenCalledWith(invite.id);
      expect(mocks.user.delete).toHaveBeenCalledWith({ id: user.id }, true);
      expect(mocks.family.addInviteUse).not.toHaveBeenCalled();
    });

    it('should give the use back when the account cannot be created', async () => {
      mocks.user.create.mockRejectedValue(new Error('database down'));

      await expect(sut.accept(dto, loginDetails)).rejects.toThrow('database down');

      expect(mocks.family.releaseInvite).toHaveBeenCalledWith(invite.id);
      expect(mocks.user.delete).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('should drop the link kept on approved requests', async () => {
      const admin = { user: { id: newUuid() } } as never;
      mocks.family.getMembership.mockResolvedValue({
        familyId: invite.familyId,
        clusterGroupId: invite.clusterGroupId,
        role: FamilyRole.Admin,
      });
      mocks.family.revokeInvite.mockResolvedValue({ ...invite } as never);

      await sut.revoke(admin, invite.id);

      expect(mocks.family.clearRequestTokens).toHaveBeenCalledWith(invite.id);
    });
  });

  describe('invites for a family person', () => {
    const admin = { user: { id: newUuid(), name: 'Admin' } } as never;
    const member = { user: { id: newUuid(), name: 'Member' } } as never;
    const personId = newUuid();
    const person = (values: Record<string, unknown> = {}) => ({
      personGroupId: personId,
      familyId: invite.familyId,
      name: 'Ann Smith',
      kind: null,
      hasPetFaces: false,
      linkedUserId: null,
      ...values,
    });
    const asRole = (role: FamilyRole) =>
      mocks.family.getMembership.mockResolvedValue({
        familyId: invite.familyId,
        clusterGroupId: invite.clusterGroupId,
        role,
      });
    const options = { role: FamilyRole.Member, maxUses: 1, expiresInDays: 7 };

    beforeEach(() => {
      mocks.crypto.randomBytesAsText.mockReturnValue('new-token');
      mocks.family.getFamilyPeople.mockResolvedValue([person()] as never);
      mocks.family.createInvite.mockImplementation(
        (values) => Promise.resolve({ ...invite, ...values, id: newUuid(), label: values.label ?? null }) as never,
      );
    });

    it('creates an invite that carries the person', async () => {
      asRole(FamilyRole.Admin);

      const result = await sut.create(admin, { ...options, personId });

      expect(mocks.family.createInvite).toHaveBeenCalledWith(expect.objectContaining({ personId }));
      expect(result).toEqual(expect.objectContaining({ personId, personName: 'Ann Smith', path: '/invite/new-token' }));
    });

    it('creates an invite without a person as before', async () => {
      asRole(FamilyRole.Admin);

      const result = await sut.create(admin, options);

      expect(mocks.family.createInvite).toHaveBeenCalledWith(expect.objectContaining({ personId: null }));
      expect(mocks.family.getFamilyPeople).not.toHaveBeenCalled();
      expect(result).toEqual(expect.objectContaining({ personId: null, personName: null }));
    });

    it('refuses a person who is already linked to an account', async () => {
      asRole(FamilyRole.Admin);
      mocks.family.getFamilyPeople.mockResolvedValue([person({ linkedUserId: newUuid() })] as never);

      await expect(sut.create(admin, { ...options, personId })).rejects.toThrow(
        'Ann Smith is already linked to an account',
      );
      expect(mocks.family.createInvite).not.toHaveBeenCalled();
    });

    it('refuses a pet', async () => {
      asRole(FamilyRole.Admin);
      mocks.family.getFamilyPeople.mockResolvedValue([person({ hasPetFaces: true })] as never);

      await expect(sut.create(admin, { ...options, personId })).rejects.toBeInstanceOf(BadRequestException);
      expect(mocks.family.createInvite).not.toHaveBeenCalled();
    });

    it('refuses a person from outside the family', async () => {
      asRole(FamilyRole.Admin);
      mocks.family.getFamilyPeople.mockResolvedValue([] as never);

      await expect(sut.create(admin, { ...options, personId })).rejects.toThrow('Person not found in the family');
    });

    it('lets only admins create one', async () => {
      asRole(FamilyRole.Member);

      await expect(sut.create(member, { ...options, personId })).rejects.toThrow('Only a family admin can do this');
    });

    it('lets a member ask for an invite for the person', async () => {
      asRole(FamilyRole.Member);
      mocks.family.createInviteRequest.mockImplementation(
        (values) =>
          Promise.resolve({
            ...values,
            id: newUuid(),
            status: 'pending',
            createdAt: new Date(),
            decidedAt: null,
            inviteToken: null,
          }) as never,
      );
      mocks.family.getMembers.mockResolvedValue([]);

      const result = await sut.createRequest(member, { name: 'Ann Smith', personId });

      expect(mocks.family.createInviteRequest).toHaveBeenCalledWith(expect.objectContaining({ personId }));
      expect(result).toEqual(expect.objectContaining({ personId, personName: 'Ann Smith' }));
    });

    it("doesn't let a member ask for a person who is already linked", async () => {
      asRole(FamilyRole.Member);
      mocks.family.getFamilyPeople.mockResolvedValue([person({ linkedUserId: newUuid() })] as never);

      await expect(sut.createRequest(member, { name: 'Ann Smith', personId })).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mocks.family.createInviteRequest).not.toHaveBeenCalled();
    });

    it("doesn't let a viewer ask", async () => {
      asRole(FamilyRole.Viewer);

      await expect(sut.createRequest(member, { name: 'Ann Smith', personId })).rejects.toThrow(
        'Viewers cannot ask for invites',
      );
    });

    it("approving a request makes an invite that carries the request's person", async () => {
      asRole(FamilyRole.Admin);
      const request = {
        id: newUuid(),
        familyId: invite.familyId,
        requestedById: newUuid(),
        name: 'Ann Smith',
        note: null,
        status: 'pending',
        personId,
      };
      mocks.family.getInviteRequest.mockResolvedValue(request as never);
      mocks.user.get.mockResolvedValue(UserFactory.create({ name: 'Member' }) as never);
      mocks.family.approveInviteRequest.mockImplementation(
        (_id, _familyId, invite, token, decidedById) =>
          Promise.resolve({
            invite: { ...invite, id: newUuid() },
            request: {
              ...request,
              status: 'approved',
              decidedById,
              inviteToken: token,
              createdAt: new Date(),
              decidedAt: new Date(),
            },
          }) as never,
      );

      const result = await sut.approveRequest(admin, request.id, options);

      expect(mocks.family.approveInviteRequest).toHaveBeenCalledWith(
        request.id,
        request.familyId,
        expect.objectContaining({ personId }),
        expect.any(String),
        (admin as { user: { id: string } }).user.id,
      );
      expect(result).toEqual(expect.objectContaining({ personId, personName: 'Ann Smith', path: '/invite/new-token' }));
    });

    it('approving refuses when the person was linked since the request', async () => {
      asRole(FamilyRole.Admin);
      mocks.family.getInviteRequest.mockResolvedValue({
        id: newUuid(),
        status: 'pending',
        requestedById: newUuid(),
        name: 'Ann Smith',
        personId,
      } as never);
      mocks.family.getFamilyPeople.mockResolvedValue([person({ linkedUserId: newUuid() })] as never);

      await expect(sut.approveRequest(admin, newUuid(), options)).rejects.toThrow(
        'Ann Smith is already linked to an account',
      );
      expect(mocks.family.approveInviteRequest).not.toHaveBeenCalled();
    });

    it('approving a request someone else decided first leaves no invite and reports it', async () => {
      asRole(FamilyRole.Admin);
      mocks.family.getInviteRequest.mockResolvedValue({
        id: newUuid(),
        status: 'pending',
        requestedById: newUuid(),
        name: 'Ann Smith',
        personId: null,
      } as never);
      mocks.family.approveInviteRequest.mockResolvedValue(void 0);

      await expect(sut.approveRequest(admin, newUuid(), options)).rejects.toThrow('already decided');
      expect(mocks.family.createInvite).not.toHaveBeenCalled();
    });

    it('the preview says who the invite is for', async () => {
      mocks.family.getInviteByTokenHash.mockResolvedValue({
        ...invite,
        familyName: 'Family',
        personId,
        personName: 'Ann Smith',
      } as never);

      await expect(sut.preview({ token: 'token' })).resolves.toEqual(
        expect.objectContaining({ personName: 'Ann Smith' }),
      );
    });

    describe('accept', () => {
      const user = UserFactory.create({ email: dto.email });

      beforeEach(() => {
        mocks.family.getInviteByTokenHash.mockResolvedValue({
          ...invite,
          familyName: 'Family',
          personId,
          personName: 'Ann Smith',
        } as never);
        mocks.user.create.mockResolvedValue(user as never);
        // joining the family: the steps of FamilyService.addUserToFamily
        mocks.family.getMembership.mockResolvedValue(void 0);
        mocks.user.get.mockResolvedValue(user as never);
        mocks.family.getMemberIds.mockResolvedValue([]);
        mocks.session.create.mockResolvedValue({} as never);
      });

      it('links the new account to the person', async () => {
        const join = vi.spyOn(FamilyService.prototype, 'addUserToFamily').mockResolvedValue();
        mocks.family.linkUnlinkedFamilyPerson.mockResolvedValue(person({ linkedUserId: user.id }) as never);

        await sut.accept(dto, loginDetails);

        expect(join).toHaveBeenCalled();
        expect(mocks.family.linkUnlinkedFamilyPerson).toHaveBeenCalledWith(invite.familyId, personId, user.id);
        expect(mocks.family.addHistory).toHaveBeenCalledWith(
          expect.objectContaining({ entityType: 'person', entityId: personId, after: { linkedUserId: user.id } }),
        );
      });

      it('still signs up, unlinked, when the person was linked in the meantime', async () => {
        vi.spyOn(FamilyService.prototype, 'addUserToFamily').mockResolvedValue();
        mocks.family.getFamilyPeople.mockResolvedValue([person({ linkedUserId: newUuid() })] as never);

        const result = await sut.accept(dto, loginDetails);

        expect(result).toEqual(expect.objectContaining({ userId: user.id }));
        expect(mocks.family.linkUnlinkedFamilyPerson).not.toHaveBeenCalled();
        expect(mocks.family.releaseInvite).not.toHaveBeenCalled();
        expect(mocks.user.delete).not.toHaveBeenCalled();
      });

      it('still signs up when someone else is linked between the check and the link', async () => {
        vi.spyOn(FamilyService.prototype, 'addUserToFamily').mockResolvedValue();
        mocks.family.linkUnlinkedFamilyPerson.mockResolvedValue(void 0);

        const result = await sut.accept(dto, loginDetails);

        expect(result).toEqual(expect.objectContaining({ userId: user.id }));
        expect(mocks.family.addHistory).not.toHaveBeenCalledWith(expect.objectContaining({ entityType: 'person' }));
      });
    });
  });
});
