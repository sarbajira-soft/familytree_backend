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
import { RelationshipsModule } from './relationships/relationships.module';
// import { RelationshipSeeder } from './relationships/seed/seed-relationships';
import { GalleryModule } from './gallery/gallery.module';
import { setupAssociations } from './associations/sequelize.associations';
import { PostModule } from './post/post.module';
import { NotificationModule } from './notification/notification.module';
import { ProductModule } from './product/product.module';
import { EventModule } from './event/event.module';

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
    PostModule,
    NotificationModule,
    RelationshipsModule,
    ProductModule,
    EventModule,
  ],
  // providers: [RelationshipSeeder],
})
export class AppModule {
  constructor() {
    setupAssociations();
  }

  // async onApplicationBootstrap() {
  //   await this.seeder.seed();
  // }
}
