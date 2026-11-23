import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  PrimaryGeneratedColumn,
  Table,
  Unique,
  type Generated,
  type Timestamp,
} from '@immich/sql-tools';
import { FamilyTable } from 'src/family/schema/family.table.js';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
A stored relationship between two people. `parent` and `godparent` are directed (personGroupId is the
parent of relatedPersonGroupId); `spouse`, `sibling` and `friend` are stored once with the smaller ID
first; `custom` is directed with a free-form label. Grandparents, cousins, in-laws and so on are
computed, never stored.
*/
@Table('family_relation')
@Unique({ columns: ['personGroupId', 'relatedPersonGroupId', 'type'] })
@Check({
  name: 'family_relation_type_chk',
  expression: `"type" IN ('parent', 'spouse', 'sibling', 'godparent', 'friend', 'custom')`,
})
@Check({
  name: 'family_relation_qualifier_chk',
  expression: `"qualifier" IS NULL OR "qualifier" IN ('step', 'adopted', 'half', 'former')`,
})
@Check({ name: 'family_relation_self_chk', expression: `"personGroupId" != "relatedPersonGroupId"` })
@Check({ name: 'family_relation_label_chk', expression: `("type" = 'custom') = ("label" IS NOT NULL)` })
export class FamilyRelationTable {
  @PrimaryGeneratedColumn()
  id!: Generated<string>;

  @ForeignKeyColumn(() => FamilyTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  familyId!: string;

  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  personGroupId!: string;

  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  relatedPersonGroupId!: string;

  @Column({ type: 'character varying' })
  type!: string;

  /** step and adopted (parent, sibling), half (sibling), former (spouse). */
  @Column({ type: 'character varying', nullable: true })
  qualifier!: string | null;

  /** Free-form label for `custom`, e.g. "best man" or "neighbour". */
  @Column({ type: 'character varying', nullable: true })
  label!: string | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  createdById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;
}
