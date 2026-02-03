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

@Table({ tableName: 'ft_tree_link' })
export class TreeLink extends Model<TreeLink> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  familyCodeLow: string;

  @Column({ type: DataType.STRING, allowNull: false })
  familyCodeHigh: string;

  @Column({ type: DataType.UUID, allowNull: false })
  nodeUidLow: string;

  @Column({ type: DataType.UUID, allowNull: false })
  nodeUidHigh: string;

  @Column({ type: DataType.STRING, allowNull: false })
  relationshipTypeLowToHigh: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'active' })
  status: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  createdBy: number;

  @CreatedAt
  @Column(DataType.DATE)
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  updatedAt: Date;
}
