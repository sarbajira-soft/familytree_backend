import { NestFactory } from '@nestjs/core';
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
const cookieParser = require('cookie-parser');
import { join } from 'path';
import * as bodyParser from 'body-parser';
import { setupSwagger } from './config/swagger';
import { Sequelize } from 'sequelize-typescript';
import { setupAssociations } from './associations/sequelize.associations';
import * as express from 'express';

export async function bootstrapApp(app: NestExpressApplication) {
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false, // Set to false to allow non-whitelisted properties
      transformOptions: {
        enableImplicitConversion: true, // Enable implicit type conversion
      },
      validationError: {
        target: false, // Don't expose the entire target object in validation errors
      },
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

  try {
    const sequelize = app.get(Sequelize);
    console.log('Connecting to database...');
    
    // Just authenticate connection - NO sync!
    // Use migration file (complete-schema-v2.sql) to create/update schema
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.');
    console.log('📋 Note: Use migration file (migrations/complete-schema-v2.sql) for schema updates');

    // Setup associations after connection
    setupAssociations();
    console.log('✅ Sequelize associations have been set up successfully.');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }

  const swaggerPath = '/api';
  setupSwagger(app, swaggerPath);
}
