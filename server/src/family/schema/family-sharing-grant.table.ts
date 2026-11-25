import { Column, CreateDateColumn, ForeignKeyColumn, Table, type Generated, type Timestamp } from '@immich/sql-tools';
import { AlbumTable } from 'src/schema/tables/album.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
A partner row the family wrote between two members. `previousInTimeline` is what was there before:
null when the row did not exist (removing the member deletes it), false when it existed but was not
shown in the timeline (removing the member sets that back). Rows the users had made themselves
(already shown in the timeline) have no grant and are never touched.
*/
@Table('family_partner_grant')
export class FamilyPartnerGrantTable {
  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  sharedById!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: true })
  sharedWithId!: string;

  @Column({ type: 'boolean', nullable: true })
  previousInTimeline!: boolean | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}

/** The same for album users: `previousRole` is null when the member was not on the album before. */
@Table('family_album_grant')
export class FamilyAlbumGrantTable {
  @ForeignKeyColumn(() => AlbumTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  albumId!: string;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true, index: true })
  userId!: string;

  @Column({ type: 'character varying', nullable: true })
  previousRole!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
