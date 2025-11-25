import { Table, Column, Model, DataType, PrimaryKey, AutoIncrement, ForeignKey } from 'sequelize-typescript';
import { FamilyMergeRequest } from './family-merge-request.model';

@Table({ tableName: 'ft_family_merge_state', timestamps: true })
export class FamilyMergeState extends Model<FamilyMergeState> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => FamilyMergeRequest)
  @Column({ type: DataType.INTEGER, allowNull: false })
  mergeRequestId: number;

  @Column({ type: DataType.STRING, allowNull: false })
  primaryFamilyCode: string;

  @Column({ type: DataType.STRING, allowNull: false })
  secondaryFamilyCode: string;

  @Column({
    type: DataType.JSONB,
    allowNull: true,
    defaultValue: {},
    get() {
      const rawValue = this.getDataValue('state');
      return rawValue ? JSON.parse(JSON.stringify(rawValue)) : {};
    },
    set(value: any) {
      this.setDataValue('state', value || {});
    },
  })
  state: Record<string, any>;
}
