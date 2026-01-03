import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
} from 'sequelize-typescript';

export enum BlockType {
  USER = 'USER',
}

@Table({ tableName: 'ft_user_block' })
export class UserBlock extends Model<UserBlock> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  blockerUserId: number;

  @Column({ type: DataType.INTEGER, allowNull: false })
  blockedUserId: number;

  @Default(BlockType.USER)
  @Column({ type: DataType.STRING, allowNull: false })
  blockType: BlockType;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;

  @Column(DataType.DATE)
  deletedAt: Date | null;
}
