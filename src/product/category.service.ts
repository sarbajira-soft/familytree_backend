import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Category } from './model/category.model';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService {
  constructor(@InjectModel(Category) private categoryModel: typeof Category) {}

  create(dto: CreateCategoryDto) {
    return this.categoryModel.create(dto);
  }

  findAll() {
    return this.categoryModel.findAll({ include: { all: true } });
  }

  async findOne(id: number) {
    const category = await this.categoryModel.findByPk(id, {
      include: { all: true },
    });
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async update(id: number, dto: UpdateCategoryDto) {
    const category = await this.findOne(id);
    return category.update(dto);
  }

  async remove(id: number) {
    const category = await this.findOne(id);
    await category.destroy();
  }
}
