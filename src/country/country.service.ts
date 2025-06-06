import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Country } from './model/country.model';
import { UpdateCountryDto } from './dto/update-country.dto';

@Injectable()
export class CountryService {
  constructor(
    @InjectModel(Country)
    private readonly countryModel: typeof Country,
  ) {}

  async createCountry(data: UpdateCountryDto) {
    const existing = await this.countryModel.findOne({ where: { name: data.name } });
    if (existing) {
      throw new BadRequestException('Country already exists');
    }

    const country = await this.countryModel.create({
      name: data.name,
      code: data.code,
      status: data.status ?? 1,
    });

    return { message: 'Country created successfully', country };
  }

  async updateCountry(id: number, data: UpdateCountryDto) {
    const country = await this.countryModel.findByPk(id);
    if (!country) {
      throw new NotFoundException('Country not found');
    }

    await country.update(data);
    return { message: 'Country updated successfully', country };
  }

  async listCountries() {
    const countries = await this.countryModel.findAll();
    return countries;
  }

  async getCountry(id: number) {
    const country = await this.countryModel.findByPk(id);
    if (!country) {
      throw new NotFoundException('Country not found');
    }
    return country;
  }

  async deleteCountry(id: number) {
    const country = await this.countryModel.findByPk(id);
    if (!country) {
      throw new NotFoundException('Country not found');
    }

    await country.destroy();
    return { message: 'Country deleted successfully' };
  }
}
