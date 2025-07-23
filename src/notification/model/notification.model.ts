import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  CreatedAt,
  HasMany,
} from 'sequelize-typescript';
import { NotificationRecipient } from './notification-recipients.model';

@Table({ tableName: 'ft_notifications' })
export class Notification extends Model<Notification> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  type: string;

  @Column({ type: DataType.STRING, allowNull: false })
  title: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  message: string;

  @Column({ type: DataType.STRING })
  familyCode: string;

  @Column(DataType.INTEGER)
  targetUserId: number;

  @Column(DataType.INTEGER)
  triggeredBy: number;

  @Column(DataType.INTEGER)
  referenceId: number;

  @HasMany(() => NotificationRecipient, 'notificationId')
  recipients: NotificationRecipient[];

  @CreatedAt
  @Column(DataType.DATE)
  createdAt: Date;
}
