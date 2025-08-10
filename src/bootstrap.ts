import { NestFactory } from '@nestjs/core';
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
const cookieParser = require('cookie-parser');
import { join } from 'path';
import * as bodyParser from 'body-parser';
import { setupSwagger } from './config/swagger';
import { Sequelize } from 'sequelize-typescript';
import * as express from 'express';

export async function bootstrapApp(app: NestExpressApplication) {
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

  const sequelize = app.get(Sequelize);
  await sequelize.sync({ force: false, alter: true });

  const swaggerPath = '/api';
  setupSwagger(app, swaggerPath);
}
