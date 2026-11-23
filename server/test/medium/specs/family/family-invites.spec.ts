import { Kysely } from 'kysely';
import { FamilyInviteService } from 'src/family/family-invite.service.js';
import { FamilyInviteStatus, FamilyRole } from 'src/family/family.enum.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { CryptoRepository } from 'src/repositories/crypto.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { NotificationRepository } from 'src/repositories/notification.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { SessionRepository } from 'src/repositories/session.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { WebsocketRepository } from 'src/repositories/websocket.repository.js';
import { DB } from 'src/schema/index.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

let defaultDatabase: Kysely<DB>;

const real = [
  AccessRepository,
  AlbumRepository,
  ClusterGroupRepository,
  CryptoRepository,
  FamilyRepository,
  NotificationRepository,
  PersonRepository,
  SessionRepository,
  UserRepository,
];

const setup = () => {
  const invites = newMediumService(FamilyInviteService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository, WebsocketRepository],
  });
  invites.ctx.getMock(EventRepository).emit.mockResolvedValue();
  invites.ctx.getMock(WebsocketRepository).clientSend.mockReturnValue();
  const family = newMediumService(FamilyService, {
    database: defaultDatabase,
    real,
    mock: [LoggingRepository, EventRepository],
  });
  return { sut: invites.sut, ctx: invites.ctx, family: family.sut };
};

type Setup = ReturnType<typeof setup>;

const loginDetails = { isSecure: false, clientIp: '127.0.0.1', deviceType: 'test', deviceOS: 'test', appVersion: null };

let emailCounter = 0;
const newEmail = () => `relative-${Date.now()}-${emailCounter++}@family.test`;

const newFamily = async ({ ctx, family }: Setup) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const { user: member } = await ctx.newUser();
  const { user: viewer } = await ctx.newUser();
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
  await family.create(adminAuth, { name: 'Bakers' });
  await family.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
  await family.addMember(adminAuth, { userId: viewer.id, role: FamilyRole.Viewer });
  return {
    admin,
    adminAuth,
    memberAuth: factory.auth({ user: member }),
    viewerAuth: factory.auth({ user: viewer }),
  };
};

const accept = (sut: FamilyInviteService, token: string, email = newEmail()) =>
  sut.accept({ token, name: 'Cousin Ann', email, password: 'a-good-password' }, loginDetails);

beforeAll(async () => {
  defaultDatabase = await getKyselyDB();
});

beforeEach(async () => {
  process.env.IMMICH_FAMILY_ENABLED = 'true';
  await defaultDatabase.deleteFrom('family').execute();
  await defaultDatabase.deleteFrom('partner').execute();
});

afterAll(() => {
  delete process.env.IMMICH_FAMILY_ENABLED;
});

describe(FamilyInviteService.name, () => {
  describe('links', () => {
    it('shows the token once, when the link is created', async () => {
      const setupResult = setup();
      const { adminAuth } = await newFamily(setupResult);

      const invite = await setupResult.sut.create(adminAuth, { role: FamilyRole.Member, maxUses: 1, expiresInDays: 7 });
      expect(invite.token).toEqual(expect.any(String));
      expect(invite.path).toBe(`/invite/${invite.token}`);
      expect(invite.status).toBe(FamilyInviteStatus.Active);

      const [listed] = await setupResult.sut.getAll(adminAuth);
      expect(listed.id).toBe(invite.id);
      expect(listed.token).toBeUndefined();
    });

    it('lets only family admins create links', async () => {
      const setupResult = setup();
      const { memberAuth } = await newFamily(setupResult);
      await expect(
        setupResult.sut.create(memberAuth, { role: FamilyRole.Member, maxUses: 1, expiresInDays: 7 }),
      ).rejects.toThrow('Only a family admin');
    });

    it('previews the family without signing in', async () => {
      const setupResult = setup();
      const { adminAuth } = await newFamily(setupResult);
      const { token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Viewer,
        maxUses: 1,
        expiresInDays: 7,
      });

      await expect(setupResult.sut.preview({ token: token! })).resolves.toEqual(
        expect.objectContaining({ familyName: 'Bakers', role: FamilyRole.Viewer, valid: true }),
      );
    });
  });

  describe('accept', () => {
    it('creates the account in the family with the link’s role and signs in', async () => {
      const setupResult = setup();
      const { admin, adminAuth } = await newFamily(setupResult);
      const { token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Viewer,
        maxUses: 1,
        expiresInDays: 7,
      });

      const login = await accept(setupResult.sut, token!);

      expect(login.accessToken).toEqual(expect.any(String));
      const membership = await setupResult.ctx.get(FamilyRepository).getMembership(login.userId);
      expect(membership?.role).toBe(FamilyRole.Viewer);
      const partner = await setupResult.ctx.database
        .selectFrom('partner')
        .selectAll()
        .where('sharedById', '=', admin.id)
        .where('sharedWithId', '=', login.userId)
        .executeTakeFirst();
      expect(partner?.inTimeline).toBe(true);

      const [invite] = await setupResult.sut.getAll(adminAuth);
      expect(invite.status).toBe(FamilyInviteStatus.UsedUp);
      expect(invite.usedBy).toEqual([expect.objectContaining({ userId: login.userId, name: 'Cousin Ann' })]);
    });

    it('refuses a single-use link the second time', async () => {
      const setupResult = setup();
      const { adminAuth } = await newFamily(setupResult);
      const { token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Member,
        maxUses: 1,
        expiresInDays: 7,
      });

      await accept(setupResult.sut, token!);
      await expect(accept(setupResult.sut, token!)).rejects.toThrow('no longer valid');
    });

    it('lets a multi-use link be used until it expires', async () => {
      const setupResult = setup();
      const { adminAuth } = await newFamily(setupResult);
      const { token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Member,
        maxUses: null,
        expiresInDays: 7,
      });

      await accept(setupResult.sut, token!);
      await accept(setupResult.sut, token!);

      const [invite] = await setupResult.sut.getAll(adminAuth);
      expect(invite.uses).toBe(2);
      expect(invite.status).toBe(FamilyInviteStatus.Active);
    });

    it('refuses an expired link', async () => {
      const setupResult = setup();
      const { adminAuth } = await newFamily(setupResult);
      const { id, token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Member,
        maxUses: 1,
        expiresInDays: 7,
      });
      await setupResult.ctx.database
        .updateTable('family_invite')
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where('id', '=', id)
        .execute();

      await expect(setupResult.sut.preview({ token: token! })).resolves.toEqual(
        expect.objectContaining({ valid: false, status: FamilyInviteStatus.Expired }),
      );
      await expect(accept(setupResult.sut, token!)).rejects.toThrow('no longer valid');
    });

    it('refuses a revoked link', async () => {
      const setupResult = setup();
      const { adminAuth } = await newFamily(setupResult);
      const { id, token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Member,
        maxUses: 1,
        expiresInDays: 7,
      });

      await setupResult.sut.revoke(adminAuth, id);

      await expect(accept(setupResult.sut, token!)).rejects.toThrow('no longer valid');
    });

    it('does not use up the link when the email is already taken', async () => {
      const setupResult = setup();
      const { admin, adminAuth } = await newFamily(setupResult);
      const { token } = await setupResult.sut.create(adminAuth, {
        role: FamilyRole.Member,
        maxUses: 1,
        expiresInDays: 7,
      });

      await expect(accept(setupResult.sut, token!, admin.email)).rejects.toThrow('Email is not available');

      const [invite] = await setupResult.sut.getAll(adminAuth);
      expect(invite.uses).toBe(0);
    });

    it('refuses an unknown link', async () => {
      const setupResult = setup();
      await newFamily(setupResult);
      await expect(accept(setupResult.sut, 'not-a-real-token-at-all')).rejects.toThrow('Invite link not found');
    });
  });

  describe('requests', () => {
    it('lets a member ask, notifies the admins, and gives the member the approved link', async () => {
      const setupResult = setup();
      const { admin, adminAuth, memberAuth } = await newFamily(setupResult);

      const request = await setupResult.sut.createRequest(memberAuth, { name: 'Cousin Ann', note: 'Mum’s side' });
      expect(request).toEqual(expect.objectContaining({ status: 'pending', path: null }));

      const notifications = await setupResult.ctx.database
        .selectFrom('notification')
        .selectAll()
        .where('userId', '=', admin.id)
        .execute();
      expect(notifications).toEqual([expect.objectContaining({ title: 'Invite request' })]);

      const approved = await setupResult.sut.approveRequest(adminAuth, request.id, {
        role: FamilyRole.Member,
        maxUses: 1,
        expiresInDays: 7,
      });
      expect(approved.status).toBe('approved');
      expect(approved.path).toMatch(/^\/invite\//);

      const [mine] = await setupResult.sut.getRequests(memberAuth);
      expect(mine.path).toBe(approved.path);

      await accept(setupResult.sut, approved.path!.replace('/invite/', ''));
      const [afterUse] = await setupResult.sut.getRequests(memberAuth);
      expect(afterUse.path).toBeNull();
    });

    it('shows members only their own requests', async () => {
      const setupResult = setup();
      const { adminAuth, memberAuth } = await newFamily(setupResult);
      await setupResult.sut.createRequest(adminAuth, { name: 'Uncle Bob' });
      await setupResult.sut.createRequest(memberAuth, { name: 'Cousin Ann' });

      const mine = await setupResult.sut.getRequests(memberAuth);
      expect(mine.map(({ name }) => name)).toEqual(['Cousin Ann']);
      expect(await setupResult.sut.getRequests(adminAuth)).toHaveLength(2);
    });

    it('does not let viewers ask', async () => {
      const setupResult = setup();
      const { viewerAuth } = await newFamily(setupResult);
      await expect(setupResult.sut.createRequest(viewerAuth, { name: 'Cousin Ann' })).rejects.toThrow(
        'Viewers cannot ask',
      );
    });

    it('declines without creating a link, once', async () => {
      const setupResult = setup();
      const { adminAuth, memberAuth } = await newFamily(setupResult);
      const request = await setupResult.sut.createRequest(memberAuth, { name: 'Cousin Ann' });

      await setupResult.sut.declineRequest(adminAuth, request.id);

      const [declined] = await setupResult.sut.getRequests(memberAuth);
      expect(declined).toEqual(expect.objectContaining({ status: 'declined', path: null }));
      expect(await setupResult.sut.getAll(adminAuth)).toEqual([]);
      await expect(setupResult.sut.declineRequest(adminAuth, request.id)).rejects.toThrow('already decided');
    });
  });
});
