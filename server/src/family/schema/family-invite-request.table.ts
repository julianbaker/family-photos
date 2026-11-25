import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  UpdateDateColumn,
  type Generated,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { FamilyInviteRequestStatus } from 'src/family/family.enum.js';
import { FamilyInviteTable } from 'src/family/schema/family-invite.table.js';
import { FamilyTable } from 'src/family/schema/family.table.js';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** A member asks for someone to be invited; an admin approves (which creates a link) or declines. */
@Table('family_invite_request')
@UpdatedAtTrigger('family_invite_request_updatedAt')
@Check({
  name: 'family_invite_request_status_chk',
  expression: `"status" IN ('pending', 'approved', 'declined')`,
})
export class FamilyInviteRequestTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FamilyTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  familyId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  requestedById!: string;

  /** Who should be invited, as the member wrote it. */
  @Column({ type: 'character varying' })
  name!: string;

  @Column({ type: 'character varying', nullable: true })
  note!: string | null;

  /** The family person to invite, when the member asked from that person's page. */
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  personId!: string | null;

  @Column({ type: 'character varying', default: FamilyInviteRequestStatus.Pending })
  status!: Generated<FamilyInviteRequestStatus>;

  @ForeignKeyColumn(() => FamilyInviteTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  inviteId!: string | null;

  /** The approved link, so the member who asked can send it on. Cleared once the link is used. */
  @Column({ type: 'character varying', nullable: true })
  inviteToken!: string | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  decidedById!: string | null;

  @Column({ type: 'timestamp with time zone', nullable: true })
  decidedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
