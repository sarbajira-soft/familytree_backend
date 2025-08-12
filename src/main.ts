import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Sequelize } from 'sequelize-typescript';
import { bootstrapApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  await bootstrapApp(app);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  //   const sequelize = app.get(Sequelize);
  // await sequelize.sync({ force: false, alter: true });
  // console.log('Database synchronization successful.');

  const baseUrl = await app.getUrl();
  console.log(`Application is running on: ${baseUrl}`);
  console.log(`Swagger UI is available on: ${baseUrl}/api`);
}

bootstrap();
