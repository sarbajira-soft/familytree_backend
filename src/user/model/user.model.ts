import { Table, Column, Model, DataType, Default } from 'sequelize-typescript';

@Table({ tableName: 'ft_user' })
export class User extends Model<User> {
  @Column({ type: DataType.STRING, unique: true, allowNull: false })
  email: string;

  @Column({ type: DataType.STRING, unique: true, allowNull: true })
  mobile: string;

  @Column(DataType.STRING)
  password: string;

  @Column(DataType.STRING)
  firstName: string;

  @Column(DataType.STRING)
  lastName: string;

  @Column(DataType.STRING)
  otp: string;

  @Column(DataType.DATE)
  otpExpiresAt: Date;

  @Column(DataType.STRING)
  accessToken: string;

  @Default(0)
  @Column(DataType.INTEGER)
  status: number; // 0=unverified, 1=active, 2=inactive

  @Default(1)
  @Column(DataType.INTEGER)
  role: number; // 1=member, 2=admin, 3=superadmin

  @Column(DataType.DATE)
  lastLoginAt: Date;

  @Column(DataType.DATE)
  verifiedAt: Date;
}