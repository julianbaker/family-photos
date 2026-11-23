import { Kysely } from 'kysely';
import { SharingDirection } from 'src/enum.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyRepository } from 'src/family/family.repository.js';
import { FamilyService } from 'src/family/family.service.js';
import { AccessRepository } from 'src/repositories/access.repository.js';
import { AlbumRepository } from 'src/repositories/album.repository.js';
import { ClusterGroupRepository } from 'src/repositories/cluster-group.repository.js';
import { EventRepository } from 'src/repositories/event.repository.js';
import { LoggingRepository } from 'src/repositories/logging.repository.js';
import { PartnerRepository } from 'src/repositories/partner.repository.js';
import { PersonRepository } from 'src/repositories/person.repository.js';
import { UserRepository } from 'src/repositories/user.repository.js';
import { DB } from 'src/schema/index.js';
import { PartnerService } from 'src/services/partner.service.js';
import { newMediumService } from 'test/medium.factory.js';
import { factory } from 'test/small.factory.js';
import { getKyselyDB } from 'test/utils.js';

// The partner rows between family members are managed by the server and never exposed.

let defaultDatabase: Kysely<DB>;

const setup = () => {
  const partners = newMediumService(PartnerService, {
    database: defaultDatabase,
    real: [AccessRepository, FamilyRepository, PartnerRepository, UserRepository],
    mock: [LoggingRepository],
  });
  const family = newMediumService(FamilyService, {
    database: defaultDatabase,
    real: [
      AccessRepository,
      AlbumRepository,
      ClusterGroupRepository,
      FamilyRepository,
      PersonRepository,
      UserRepository,
    ],
    mock: [LoggingRepository, EventRepository],
  });
  return { sut: partners.sut, ctx: partners.ctx, family: family.sut };
};

/** A family of two, and a friend outside the family who shares with the member the stock way. */
const newFamilyAndFriend = async ({ ctx, family }: ReturnType<typeof setup>) => {
  const { user: admin } = await ctx.newUser({ isAdmin: true });
  const { user: member } = await ctx.newUser();
  const { user: friend } = await ctx.newUser();
  const adminAuth = factory.auth({ user: { ...admin, isAdmin: true } });
  await family.create(adminAuth, {});
  await family.addMember(adminAuth, { userId: member.id, role: FamilyRole.Member });
  await ctx.newPartner({ sharedById: friend.id, sharedWithId: member.id });
  return { admin, member: factory.auth({ user: member }), friend };
};

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

describe('family partner sharing', () => {
  it('lists only partners outside the family', async () => {
    const setupResult = setup();
    const { member, friend } = await newFamilyAndFriend(setupResult);

    const sharedWithMe = await setupResult.sut.search(member, { direction: SharingDirection.SharedWith });
    expect(sharedWithMe.map(({ id }) => id)).toEqual([friend.id]);

    const sharedByMe = await setupResult.sut.search(member, { direction: SharingDirection.SharedBy });
    expect(sharedByMe).toEqual([]);
  });

  it('refuses to stop sharing with a family member', async () => {
    const setupResult = setup();
    const { admin, member } = await newFamilyAndFriend(setupResult);

    await expect(setupResult.sut.remove(member, admin.id)).rejects.toThrow('Sharing within the family is automatic');
    await expect(setupResult.sut.update(member, admin.id, { inTimeline: false })).rejects.toThrow(
      'Sharing within the family is automatic',
    );
  });

  it('leaves sharing with someone outside the family as it is in stock Immich', async () => {
    const setupResult = setup();
    const { member, friend } = await newFamilyAndFriend(setupResult);

    await expect(setupResult.sut.update(member, friend.id, { inTimeline: false })).resolves.toEqual(
      expect.objectContaining({ id: friend.id, inTimeline: false }),
    );
  });
});
