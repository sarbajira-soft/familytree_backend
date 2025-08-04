import { Table, Column, Model, PrimaryKey, Default, DataType, ForeignKey } from 'sequelize-typescript';
import { User } from '../user/model/user.model';

@Table({ tableName: 'invites', timestamps: true, paranoid: true })
export class Invite extends Model<Invite> {
  @PrimaryKey
  @Default(DataType.UUIDV4)
  @Column(DataType.UUID)
  id: string;

  @Column({ allowNull: false })
  phone: string;

  @Column({ allowNull: false })
  token: string;

  @ForeignKey(() => User)
  @Column(DataType.INTEGER)
  inviterId: number;

  @Column({ type: DataType.INTEGER, allowNull: true })
  spouseMemberId: number;

  @Column({ type: DataType.DATE, allowNull: false })
  expiresAt: Date;

  @Default('pending')
  @Column({ type: DataType.ENUM('pending', 'accepted', 'expired') })
  status: 'pending' | 'accepted' | 'expired';
}
