import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  CreatedAt,
  UpdatedAt,
} from 'sequelize-typescript';

@Table({ tableName: 'ft_family_link' })
export class FamilyLink extends Model<FamilyLink> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  familyCodeLow: string;

  @Column({ type: DataType.STRING, allowNull: false })
  familyCodeHigh: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'tree' })
  source: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'active' })
  status: string;

  @CreatedAt
  @Column(DataType.DATE)
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  updatedAt: Date;
}
