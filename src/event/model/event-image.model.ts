import {
  Table,
  Column,
  Model,
  DataType,
  PrimaryKey,
  AutoIncrement,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { Event } from './event.model';
 
@Table({ tableName: 'ft_event_image' })
export class EventImage extends Model<EventImage> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.INTEGER)
  id: number;

  @ForeignKey(() => Event)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  eventId: number;

  @BelongsTo(() => Event)
  event: Event;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  imageUrl: string;
} 