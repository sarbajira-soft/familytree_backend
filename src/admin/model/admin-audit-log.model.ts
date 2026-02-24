import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';

import { AdminLogin } from './admin-login.model';

@Table({ tableName: 'admin_audit_logs', timestamps: false })
export class AdminAuditLog extends Model<AdminAuditLog> {
  @Column({ type: DataType.BIGINT, primaryKey: true, autoIncrement: true })
  id: number;

  @ForeignKey(() => AdminLogin)
  @Column({ field: 'admin_id', type: DataType.INTEGER, allowNull: false })
  adminId: number;

  @Column({ type: DataType.STRING(100), allowNull: false })
  action: string;

  @Column({ field: 'target_type', type: DataType.STRING(50), allowNull: true })
  targetType?: string;

  @Column({ field: 'target_id', type: DataType.INTEGER, allowNull: true })
  targetId?: number;

  @Column({ type: DataType.JSONB, allowNull: true })
  metadata?: any;

  @Column({ field: 'created_at', type: DataType.DATE, allowNull: true })
  createdAt?: Date;

  @BelongsTo(() => AdminLogin)
  admin?: AdminLogin;
}
