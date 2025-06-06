import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Language } from './model/language.model';
import { UpdateLanguageDto } from './dto/update-language.dto';

@Injectable()
export class LanguageService {
  constructor(
    @InjectModel(Language)
    private readonly languageModel: typeof Language,
  ) {}

  async createLanguage(data: UpdateLanguageDto) {
    const existing = await this.languageModel.findOne({ where: { name: data.name } });
    if (existing) {
      throw new BadRequestException('Language already exists');
    }

    const language = await this.languageModel.create({
      name: data.name,
      isoCode: data.isoCode,
      status: data.status ?? 1,
    });

    return { message: 'Language created successfully', language };
  }

  async updateLanguage(id: number, data: UpdateLanguageDto) {
    const language = await this.languageModel.findByPk(id);
    if (!language) {
      throw new NotFoundException('Language not found');
    }

    await language.update(data);
    return { message: 'Language updated successfully', language };
  }

  async listLanguages() {
    return await this.languageModel.findAll();
  }

  async getLanguage(id: number) {
    const language = await this.languageModel.findByPk(id);
    if (!language) {
      throw new NotFoundException('Language not found');
    }
    return language;
  }

  async deleteLanguage(id: number) {
    const language = await this.languageModel.findByPk(id);
    if (!language) {
      throw new NotFoundException('Language not found');
    }

    await language.destroy();
    return { message: 'Language deleted successfully' };
  }
}
