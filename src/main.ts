import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Sequelize } from 'sequelize-typescript';
import { setupSwagger } from './config/swagger';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { join } from 'path';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Increase payload size limits
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.use(cookieParser());

  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // const sequelize = app.get(Sequelize);
  // await sequelize.sync({ force: false, alter: true });
  // console.log('Database synchronization successful.');

  const swaggerPath = '/api';
  setupSwagger(app, swaggerPath);

  const port = process.env.PORT || 3000;
  await app.listen(port);

  const baseUrl = await app.getUrl();
  console.log(`Application is running on: ${baseUrl}`);
  console.log(`Swagger UI is available on: ${baseUrl}${swaggerPath}`);
}

bootstrap();
