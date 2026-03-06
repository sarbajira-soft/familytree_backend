import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  PrimaryKey,
  AutoIncrement,
  Default,
} from 'sequelize-typescript';
import { User } from './user.model';

@Table({ tableName: 'ft_account_recovery_token' })
export class AccountRecoveryToken extends Model<AccountRecoveryToken> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column({ type: DataType.STRING, allowNull: false })
  tokenHash: string;

  @Column({ type: DataType.DATE, allowNull: false })
  expiresAt: Date;

  @Column({ type: DataType.DATE, allowNull: true })
  usedAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;
}
