import { Column, ForeignKeyColumn, Table, type Timestamp } from '@immich/sql-tools';
import { AssetTable } from 'src/schema/tables/asset.table.js';

/**
Which photos pet recognition has looked at, and with which models, so the catch-up pass over the
library can stop and resume anywhere, and a model change rescans everything once.
*/
@Table('family_pet_scan')
export class FamilyPetScanTable {
  @ForeignKeyColumn(() => AssetTable, { onDelete: 'CASCADE', onUpdate: 'CASCADE', primary: true })
  assetId!: string;

  @Column({ type: 'character varying' })
  modelVersion!: string;

  @Column({ type: 'timestamp with time zone' })
  scannedAt!: Timestamp;
}
