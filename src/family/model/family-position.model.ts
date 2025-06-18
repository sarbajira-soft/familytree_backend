import { Table, Column, Model, DataType, ForeignKey, BelongsTo } from 'sequelize-typescript';
import { User } from '../../user/model/user.model';
import { Family } from './family.model';

@Table({
  tableName: 'ft_family_positions',
  timestamps: true,
})
export class FtFamilyPosition extends Model<FtFamilyPosition> {
  @Column({ primaryKey: true, autoIncrement: true, type: DataType.INTEGER })
  id: number;

  @Column({ type: DataType.STRING, allowNull: false })
  familyCode: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  userId: number;

  @Column({ type: DataType.STRING, allowNull: false })
  position: string;

  @Column({ type: DataType.ENUM('male', 'female'), allowNull: false })
  gender: 'male' | 'female';

  @Column({ type: DataType.INTEGER, allowNull: true })
  parentId?: number;

  @BelongsTo(() => User)
  user?: User;

}
