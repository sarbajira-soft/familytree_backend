import {
  AutoIncrement,
  BelongsTo,
  Column,
  DataType,
  Default,
  ForeignKey,
  Model,
  PrimaryKey,
  Table,
} from 'sequelize-typescript';
import { User } from '../../user/model/user.model';

export enum BlockType {
  USER = 'USER',
}

@Table({
  tableName: 'ft_user_block',
  paranoid: false,
  indexes: [
    {
      name: 'unique_active_block',
      unique: true,
      fields: ['blockerUserId', 'blockedUserId'],
      where: { deletedAt: null },
    },
  ],
})
export class FtUserBlock extends Model<FtUserBlock> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  blockerUserId: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  blockedUserId: number;

  @Default(BlockType.USER)
  @Column({ type: DataType.STRING, allowNull: false })
  blockType: BlockType;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  createdAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  updatedAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  deletedAt: Date | null;

  @BelongsTo(() => User, 'blockerUserId')
  blockerUser: User;

  @BelongsTo(() => User, 'blockedUserId')
  blockedUser: User;
}

export const UserBlock = FtUserBlock;
