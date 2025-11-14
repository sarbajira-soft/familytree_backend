import { Table, Column, Model, DataType } from 'sequelize-typescript';

@Table({ tableName: 'relationships' })
export class Relationship extends Model {
  @Column({
    type: DataType.STRING,
    unique: true,
    allowNull: false,
  })
  key: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  description: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_en_f: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_en_m: string;


  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ta_f: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ta_m:string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_hi_f: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_hi_m: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ma_f: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ma_m: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ka_f: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_ka_m: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_te_f: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  description_te_m: string;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: true,
    defaultValue: false,
  })
  is_auto_generated: boolean;

}
