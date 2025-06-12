import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { ConfigModule } from '@nestjs/config';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { CountryModule } from './country/country.module';
import { ReligionModule } from './religion/religion.module';
import { LanguageModule } from './language/language.module';
import { GothramModule } from './gothram/gothram.module';
import { FamilyModule } from './family/family.module';
import { GalleryModule } from './gallery/gallery.module';
import { setupAssociations } from './associations/sequelize.associations';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SequelizeModule.forRoot({
      dialect: 'postgres',
      host: process.env.DB_HOST,
      port: +process.env.DB_PORT,
      username: process.env.DB_USER,
      password: process.env.DB_PASS,
      database: process.env.DB_NAME,
      autoLoadModels: true,
      synchronize: true,
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      },
    }),
    UserModule,
    AuthModule,
    CountryModule,
    ReligionModule,
    LanguageModule,
    GothramModule,
    FamilyModule,
    GalleryModule,
  ],
})
export class AppModule {
  constructor() {
    setupAssociations();
  }
}
