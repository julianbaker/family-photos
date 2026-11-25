import {
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  type Generated,
  type Timestamp,
} from '@immich/sql-tools';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
A one-time code that signs the iOS app in as the person who made it on the website. Only a hash of the
code is stored, like invite tokens. A code works once and only for a few minutes.
*/
@Table('family_app_login_code')
export class FamilyAppLoginCodeTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  userId!: string;

  @Column({ type: 'bytea', unique: true })
  codeHash!: Buffer;

  @Column({ type: 'timestamp with time zone' })
  expiresAt!: Timestamp;

  /** Set when the app redeems the code; a used code never works again. */
  @Column({ type: 'timestamp with time zone', nullable: true })
  usedAt!: Timestamp | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
