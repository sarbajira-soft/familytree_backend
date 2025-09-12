import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  Default,
} from 'sequelize-typescript';
import { User } from '../../user/model/user.model';

@Table({ tableName: 'ft_family_members' })
export class FamilyMember extends Model<FamilyMember> {
  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  memberId: number;

  @Column({ type: DataType.STRING, allowNull: false })
  familyCode: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: true })
  creatorId: number;

  @Default('pending') // default status
  @Column({
    type: DataType.ENUM('pending', 'approved', 'rejected'),
    allowNull: false,
  })
  approveStatus: 'pending' | 'approved' | 'rejected';

  @Default(false)
  @Column({ type: DataType.BOOLEAN, allowNull: false, field: 'isLinkedUsed' })
  isLinkUsed: boolean;
}
