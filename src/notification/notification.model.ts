import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import { User } from '../user/model/user.model';

@Table({
  tableName: 'dashboard_notifications',
  timestamps: true,
  indexes: [
    { fields: ['userId'] },
    { fields: ['createdAt'] },
    { fields: ['read'] },
  ],
})
export class DashboardNotification extends Model<DashboardNotification> {
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column({ type: DataType.TEXT, allowNull: false })
  message: string;

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false })
  read: boolean;

  @Default('birthday')
  @Column({
    type: DataType.ENUM('birthday', 'reminder', 'system', 'family'),
    allowNull: false,
  })
  notificationType: string;
}
