import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
  type Generated,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyTable } from 'src/family/schema/family.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** A user belongs to at most one family. Its role is separate from the server admin flag. */
@Table('family_member')
@UpdatedAtTrigger('family_member_updatedAt')
@Check({ name: 'family_member_role_chk', expression: `"role" IN ('admin', 'member', 'viewer')` })
export class FamilyMemberTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  userId!: string;

  @ForeignKeyColumn(() => FamilyTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  familyId!: string;

  @Column({ type: 'character varying' })
  role!: FamilyRole;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  addedById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
