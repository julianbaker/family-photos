import {
  Check,
  Column,
  CreateDateColumn,
  ForeignKeyColumn,
  Table,
  UpdateDateColumn,
  type Generated,
  type Timestamp,
} from '@immich/sql-tools';
import { UpdateIdColumn, UpdatedAtTrigger } from 'src/decorators.js';
import { FamilyTable } from 'src/family/schema/family.table.js';
import { PersonGroupTable } from 'src/schema/tables/person-group.table.js';
import { UserTable } from 'src/schema/tables/user.table.js';

/**
The family's shared record of a person (a face-recognition person group). Its name and birth date are
copied into every member's own `person` row, so stock screens, search and sync show the family's
names. People without photos (ancestors) are person groups with no faces.
*/
@Table('family_person')
@UpdatedAtTrigger('family_person_updatedAt')
@Check({ name: 'family_person_gender_chk', expression: `"gender" IS NULL OR "gender" IN ('female', 'male')` })
@Check({ name: 'family_person_kind_chk', expression: `"kind" IS NULL OR "kind" IN ('person', 'pet')` })
@Check({
  name: 'family_person_dates_chk',
  expression: `"deathDate" IS NULL OR "birthDate" IS NULL OR "deathDate" >= "birthDate"`,
})
export class FamilyPersonTable {
  @ForeignKeyColumn(() => PersonGroupTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  personGroupId!: string;

  @ForeignKeyColumn(() => FamilyTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', nullable: false })
  familyId!: string;

  @Column({ type: 'character varying', default: '' })
  name!: Generated<string>;

  @Column({ type: 'date', nullable: true })
  birthDate!: Timestamp | null;

  @Column({ type: 'date', nullable: true })
  deathDate!: Timestamp | null;

  /** Optional; only used for relation words like "grandmother" instead of "grandparent". */
  @Column({ type: 'character varying', nullable: true })
  gender!: string | null;

  /**
  "person" or "pet", when set by hand (a pet with no photos); null means worked out from the faces: a
  group whose faces were found by pet recognition is a pet.
  */
  @Column({ type: 'character varying', nullable: true })
  kind!: string | null;

  /** Simple formatting: paragraphs, **bold**, *italic* and [links](https://...). */
  @Column({ type: 'text', nullable: true })
  bio!: string | null;

  /** The member account this person is ("this is me"). */
  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true, unique: true })
  linkedUserId!: string | null;

  @ForeignKeyColumn(() => UserTable, { onDelete: 'SET NULL', onUpdate: 'CASCADE', nullable: true })
  updatedById!: string | null;

  @CreateDateColumn()
  createdAt!: Generated<Timestamp>;

  @UpdateDateColumn()
  updatedAt!: Generated<Timestamp>;

  @UpdateIdColumn({ index: true })
  updateId!: Generated<string>;
}
