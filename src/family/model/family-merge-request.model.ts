import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, Default } from 'sequelize-typescript';

@Table({ tableName: 'ft_family_merge_request', timestamps: true })
export class FamilyMergeRequest extends Model<FamilyMergeRequest> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  primaryFamilyCode: string;

  @Column({ type: DataType.STRING, allowNull: false })
  secondaryFamilyCode: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  requestedByAdminId: number;

  @Default('open')
  @Column({ type: DataType.STRING, allowNull: false })
  primaryStatus: string; // open | accepted | rejected | merged (primary family decision)

  @Default('pending')
  @Column({ type: DataType.STRING, allowNull: false })
  secondaryStatus: string; // pending | acknowledged | rejected (secondary family awareness)

  @Column({ type: DataType.TEXT, allowNull: true })
  duplicatePersonsInfo: string; // JSON array of duplicate persons (same person in both families)

  @Column({ type: DataType.TEXT, allowNull: true })
  conflictSummary: string; // JSON summary of conflicts and scenarios

  @Column({ type: DataType.STRING, allowNull: true })
  noMatchStrategy: string; // ADD_ALL | MANUAL_ADJUSTMENT | GENERATION_OFFSET

  @Column({ type: DataType.INTEGER, allowNull: true })
  appliedGenerationOffset: number; // Offset applied to Family B

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  isNoMatchMerge: boolean; // Flag for no match scenario

  @Column({ type: DataType.JSONB, allowNull: true })
  anchorConfig?: any; // Optional anchor mapping between primary and secondary
}
