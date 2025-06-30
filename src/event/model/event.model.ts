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

@Table({ tableName: 'ft_event' })
export class Event extends Model<Event> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  userId: number;

  @BelongsTo(() => User)
  user: User;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  eventTitle: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  eventDescription: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  eventDate: string;

  @Column({
    type: DataType.TIME,
    allowNull: true,
  })
  eventTime: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  location: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  eventImages: string; // JSON string to store multiple image paths

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  familyCode: string;

  @Default(0)
  @Column(DataType.INTEGER)
  createdBy: number;

  @Default(1)
  @Column(DataType.INTEGER)
  status: number; // 1 = active, 0 = inactive
}
