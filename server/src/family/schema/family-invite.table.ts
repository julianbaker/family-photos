import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  UpdateDateColumn,
  type Generated,
  type Timestamp,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { FamilyRole } from 'src/family/family.enum.js';
import { FamilyTable } from 'src/family/schema/family.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** An invite link. Only a hash of its token is stored; the link itself is shown once, when created. */
@Table('family_invite')
@UpdatedAtTrigger('family_invite_updatedAt')
@Check({ name: 'family_invite_role_chk', expression: `"role" IN ('admin', 'member', 'viewer')` })
@Check({ name: 'family_invite_uses_chk', expression: `"maxUses" IS NULL OR "uses" <= "maxUses"` })
export class FamilyInviteTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FamilyTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  familyId!: string;

  @Column({ type: 'bytea', unique: true })
  tokenHash!: Buffer;

  /** Optional label for the admin, e.g. who the link was sent to. */
  @Column({ type: 'character varying', nullable: true })
  label!: string | null;

  @Column({ type: 'character varying' })
  role!: FamilyRole;

  /** Null means the link can be used any number of times until it expires or is revoked. */
  @Column({ type: 'integer', nullable: true })
  maxUses!: number | null;

  @Column({ type: 'integer', default: 0 })
  uses!: Generated<number>;

  @Column({ type: 'timestamp with time zone' })
  expiresAt!: Timestamp;

  @Column({ type: 'timestamp with time zone', nullable: true })
  revokedAt!: Timestamp | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  createdById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
