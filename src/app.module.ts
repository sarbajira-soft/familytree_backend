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
import { GalleryModule } from './gallery/gallery.module';
// import { setupAssociations } from './associations/sequelize.associations'; // Moved to bootstrap.ts and lambda.ts
import { PostModule } from './post/post.module';
import { NotificationModule } from './notification/notification.module';
import { ProductModule } from './product/product.module';
import { EventModule } from './event/event.module';
import { InviteModule } from './invite/invite.module';
import { BlockingModule } from './blocking/blocking.module';
import { AdminModule } from './admin/admin.module';

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
      synchronize: false, // Disable auto-sync, we'll handle it in bootstrap
      // sync: { alter: true }, // Moved to bootstrap.ts
      logging: process.env.NODE_ENV === 'development' ? console.log : false, // ← Enable logging in dev to see slow queries
      pool: {
        max: 5, // Reduce max connections for stability
        min: 0,  // Minimum number of connections
        acquire: 60000, // Increase to 60 seconds
        idle: 10000,    // Maximum time (ms) connection can be idle
      },
      dialectOptions: {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
        connectTimeout: 60000, // Increase to 60 seconds
        requestTimeout: 60000, // Increase to 60 seconds
      },
      retry: {
        max: 3, // Maximum retry attempts
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
    BlockingModule,
    RelationshipsModule,
    ProductModule,
    EventModule,
    InviteModule,
    AdminModule,
  ],
})
export class AppModule {
  // setupAssociations() moved to bootstrap.ts and lambda.ts after database sync
  // to prevent timing issues with model initialization

}
