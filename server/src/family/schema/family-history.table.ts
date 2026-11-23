import { Column, CreateDateColumn, ForeignKeyColumn, Table, Timestamp, type Generated } from '@immich/sql-tools';
import { PrimaryGeneratedUuidV7Column } from 'src/decorators.js';
import { FamilyTable } from 'src/family/schema/family.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/** Who changed what in the family, and when, so a change can be reviewed or reverted. */
@Table('family_history')
export class FamilyHistoryTable {
  @PrimaryGeneratedUuidV7Column()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FamilyTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  familyId!: string;

  /** The member who made the change; null once that user is deleted. */
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  userId!: string | null;

  @Column({ type: 'character varying' })
  action!: string;

  @Column({ type: 'character varying' })
  entityType!: string;

  @Column({ type: 'uuid', nullable: true, index: true })
  entityId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: Record<string, unknown> | null;

  @CreateDateColumn({ index: true })
  createdAt!: Generated<Timestamp>;
}
