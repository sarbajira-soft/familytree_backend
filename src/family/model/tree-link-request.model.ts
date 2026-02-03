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

@Table({ tableName: 'ft_tree_link_request' })
export class TreeLinkRequest extends Model<TreeLinkRequest> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  senderFamilyCode: string;

  @Column({ type: DataType.STRING, allowNull: false })
  receiverFamilyCode: string;

  @Column({ type: DataType.UUID, allowNull: false })
  senderNodeUid: string;

  @Column({ type: DataType.UUID, allowNull: false })
  receiverNodeUid: string;

  @Column({ type: DataType.STRING, allowNull: false })
  relationshipType: string;

  @Column({ type: DataType.STRING, allowNull: true })
  parentRole: string;

  @Column({ type: DataType.STRING, allowNull: false, defaultValue: 'pending' })
  status: string;

  @Column({ type: DataType.INTEGER, allowNull: true })
  createdBy: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  respondedBy: number;

  @CreatedAt
  @Column(DataType.DATE)
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE)
  updatedAt: Date;
}
