import { Table, Column, Model, DataType, ForeignKey, Default } from 'sequelize-typescript';
import { User } from './user.model';

@Table({ tableName: 'ft_invite' })
export class Invite extends Model<Invite> {
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER })
  inviteFrom: number;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER })
  userId: number;

  @Column({ type: DataType.STRING, allowNull: true })
  familyCode: string;

  @Column({ 
    type: DataType.ENUM('FAMILY_JOIN', 'POST_CREATE', 'GALLERY_CREATE'), 
    allowNull: false 
  })
  inviteType: 'FAMILY_JOIN' | 'POST_CREATE' | 'GALLERY_CREATE';

  @Default('PENDING')
  @Column({ 
    type: DataType.ENUM('PENDING', 'APPROVED', 'REJECTED'),
    allowNull: false
  })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @Column({ type: DataType.STRING, allowNull: true })
  remarks: string;
}
