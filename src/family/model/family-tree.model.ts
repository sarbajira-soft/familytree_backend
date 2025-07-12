import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  PrimaryKey,
  AutoIncrement,
} from 'sequelize-typescript';
import { User } from '../../user/model/user.model';

@Table({ tableName: 'ft_family_tree' })
export class FamilyTree extends Model<FamilyTree> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  familyCode: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true, // Can be null for non-users
  })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  generation: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  personId: number; // Position ID for each member

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  parents: number[];

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  children: number[];

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  spouses: number[];

  @Column({
    type: DataType.JSON,
    allowNull: true,
  })
  siblings: number[];
} 