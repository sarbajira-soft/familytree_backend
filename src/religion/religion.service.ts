import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Religion } from './model/religion.model';
import { CreateReligionDto } from './dto/create-religion.dto';

@Injectable()
export class ReligionService {
  constructor(
    @InjectModel(Religion)
    private readonly religionModel: typeof Religion,
  ) {}

  async createReligion(dto: CreateReligionDto) {
    const existing = await this.religionModel.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new BadRequestException('Religion already exists');
    }

    const religion = await this.religionModel.create({
      name: dto.name,
      status: dto.status ?? 1,
    });

    return { message: 'Religion created successfully', religion };
  }

  async listReligions() {
    return this.religionModel.findAll();
  }

  async getReligion(id: number) {
    const religion = await this.religionModel.findByPk(id);
    if (!religion) {
      throw new NotFoundException('Religion not found');
    }
    return religion;
  }

  async updateReligion(id: number, dto: CreateReligionDto) {
    const religion = await this.religionModel.findByPk(id);
    if (!religion) {
      throw new NotFoundException('Religion not found');
    }

    await religion.update(dto);
    return { message: 'Religion updated successfully', religion };
  }

  async deleteReligion(id: number) {
    const religion = await this.religionModel.findByPk(id);
    if (!religion) {
      throw new NotFoundException('Religion not found');
    }

    await religion.destroy();
    return { message: 'Religion deleted successfully' };
  }
}
