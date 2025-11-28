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
import { runMigrations, checkMigrationStatus } from './database/run-migration';
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
    console.log('🔗 Connecting to database...');
    
    // Authenticate connection
    await sequelize.authenticate();
    console.log('✅ Database connected successfully.');

    // Run migrations
    console.log('\n📦 Running database migrations...');
    await runMigrations(sequelize);

    // Check migration status
    await checkMigrationStatus(sequelize);

    // Setup associations after migrations
    setupAssociations();
    console.log('✅ Sequelize associations have been set up successfully.');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }

  const swaggerPath = '/api';
  setupSwagger(app, swaggerPath);
}
