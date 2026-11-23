import { CreateDateColumn, ForeignKeyColumn, Table, Timestamp, type Generated } from '@immich/sql-tools';
import { FamilyInviteTable } from 'src/family/schema/family-invite.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** Who joined through which invite link. */
@Table('family_invite_use')
export class FamilyInviteUseTable {
  @ForeignKeyColumn(() => FamilyInviteTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  inviteId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  userId!: string;

  @CreateDateColumn()
  usedAt!: Generated<Timestamp>;
}
