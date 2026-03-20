import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';

import { User } from '../../user/model/user.model';

export type ContentReportTargetType = 'post' | 'gallery' | 'event';
export type ContentReportStatus = 'open' | 'reviewed' | 'dismissed' | 'action_taken';

@Table({ tableName: 'ft_content_report' })
export class ContentReport extends Model<ContentReport> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({ type: DataType.STRING(16), allowNull: false })
  targetType: ContentReportTargetType;

  @Column({ type: DataType.INTEGER, allowNull: false })
  targetId: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  reportedByUserId: number;

  @BelongsTo(() => User)
  reporter: User;

  @Column({ type: DataType.STRING(64), allowNull: false })
  reason: string;

  @Column({ type: DataType.TEXT, allowNull: true })
  description: string;

  @Default('open')
  @Column({ type: DataType.STRING(24), allowNull: false })
  status: ContentReportStatus;

  @Column({ type: DataType.INTEGER, allowNull: true })
  reviewedByAdminId: number;

  @Column({ type: DataType.DATE, allowNull: true })
  reviewedAt: Date;

  @Column({ type: DataType.TEXT, allowNull: true })
  adminNote: string;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  createdAt: Date;

  @Default(DataType.NOW)
  @Column(DataType.DATE)
  updatedAt: Date;
}
