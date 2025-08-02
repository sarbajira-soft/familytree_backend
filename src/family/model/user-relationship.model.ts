import {
  Table,
  Column,
  Model,
  DataType,
  ForeignKey,
  BelongsTo,
  PrimaryKey,
  AutoIncrement,
  Default,
} from 'sequelize-typescript';
import { User } from '../../user/model/user.model';

@Table({ tableName: 'ft_user_relationships' })
export class UserRelationship extends Model<UserRelationship> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  user1Id: number;

  @BelongsTo(() => User, { foreignKey: 'user1Id', as: 'user1' })
  user1: User;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  user2Id: number;

  @BelongsTo(() => User, { foreignKey: 'user2Id', as: 'user2' })
  user2: User;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  relationshipType: string; // 'spouse', 'parent-child', 'sibling', 'in-law', etc.

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  generatedFamilyCode: string; // Auto-generated family code for this relationship

  @Default(true)
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
  })
  isBidirectional: boolean; // Whether this relationship is recorded in both directions

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  createdAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  updatedAt: Date;
} 