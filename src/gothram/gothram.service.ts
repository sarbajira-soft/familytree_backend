import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Gothram } from './model/gothram.model';
import { UpdateGothramDto } from './dto/update-gothram.dto';

@Injectable()
export class GothramService {
  constructor(
    @InjectModel(Gothram)
    private readonly gothramModel: typeof Gothram,
  ) {}

  async createGothram(dto: UpdateGothramDto) {
    const existing = await this.gothramModel.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new BadRequestException('Gothram already exists');
    }

    const gothram = await this.gothramModel.create({
      name: dto.name,
      status: dto.status ?? 1,
    });

    return { message: 'Gothram created successfully', gothram };
  }

  async listGothrams() {
    return this.gothramModel.findAll();
  }

  async getGothram(id: number) {
    const gothram = await this.gothramModel.findByPk(id);
    if (!gothram) {
      throw new NotFoundException('Gothram not found');
    }
    return gothram;
  }

  async updateGothram(id: number, dto: UpdateGothramDto) {
    const gothram = await this.gothramModel.findByPk(id);
    if (!gothram) {
      throw new NotFoundException('Gothram not found');
    }

    await gothram.update(dto);
    return { message: 'Gothram updated successfully', gothram };
  }

  async deleteGothram(id: number) {
    const gothram = await this.gothramModel.findByPk(id);
    if (!gothram) {
      throw new NotFoundException('Gothram not found');
    }

    await gothram.destroy();
    return { message: 'Gothram deleted successfully' };
  }
}
