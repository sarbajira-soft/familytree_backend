import {
  Table,
  Column,
  Model,
  DataType,
  Default,
} from 'sequelize-typescript';

@Table({ tableName: 'ft_admin_login' })
export class AdminLogin extends Model<AdminLogin> {
  @Column({ type: DataType.UUID, allowNull: false, defaultValue: DataType.UUIDV4 })
  uuid: string;

  @Column({ type: DataType.STRING, allowNull: false, unique: true })
  email: string;

  @Column({ type: DataType.STRING, allowNull: false })
  password: string;

  @Column({ type: DataType.STRING, allowNull: true })
  fullName: string;

  @Default('admin')
  @Column({ type: DataType.ENUM('admin', 'superadmin'), allowNull: false })
  role: 'admin' | 'superadmin';

  @Default(1)
  @Column({ type: DataType.INTEGER, allowNull: false })
  status: number;

  @Column({ type: DataType.DATE, allowNull: true })
  lastLoginAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  createdAt: Date;

  @Default(DataType.NOW)
  @Column({ type: DataType.DATE, allowNull: false })
  updatedAt: Date;
}
