import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  Default,
} from 'sequelize-typescript';

@Table({ tableName: 'ft_event' })
export class Event extends Model<Event> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  eventName: string;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  eventDescription: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  eventImage: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  eventStartDate: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: true,
  })
  eventEndDate: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  familyCode: string;

  @Default(0)
  @Column(DataType.INTEGER)
  createdBy: number;

  @Default(1)
  @Column(DataType.INTEGER)
  status: number; // 1 = active, 0 = inactive
}
