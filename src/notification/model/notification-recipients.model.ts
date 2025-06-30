import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
  CreatedAt,
} from 'sequelize-typescript';
import { Notification } from './notification.model';

@Table({ tableName: 'ft_notification_recipients' })
export class NotificationRecipient extends Model<NotificationRecipient> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => Notification)
  @Column(DataType.INTEGER)
  notificationId: number;

  @Column(DataType.INTEGER)
  userId: number;

  @Column({ type: DataType.BOOLEAN, defaultValue: false })
  isRead: boolean;

  @Column(DataType.DATE)
  readAt: Date;

  @BelongsTo(() => Notification)
  notification: Notification;
}
