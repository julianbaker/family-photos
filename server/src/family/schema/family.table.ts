import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  Timestamp,
  Unique,
  UpdateDateColumn,
  type Generated,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { ClusterGroupTable } from 'src/schema/tables/cluster-group.table.js';

/** A family is one cluster group whose members share one library, people and albums. */
@Table('family')
@UpdatedAtTrigger('family_updatedAt')
@Unique({ columns: ['clusterGroupId'] })
export class FamilyTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => ClusterGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  clusterGroupId!: string;

  @Column({ type: 'character varying', default: 'Family' })
  name!: Generated<string>;

  /** The text shown in place of a logo on the website (sign-in page, top bar). Empty means "sibred". */
  @Column({ type: 'character varying', nullable: true })
  wordmark!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
