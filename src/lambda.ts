import { Context, Callback, APIGatewayProxyEvent } from 'aws-lambda';
import { configure as serverlessExpress } from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import express from 'express';
import cookieParser from 'cookie-parser';
import bodyParser from 'body-parser';
import { join } from 'path';
import { setupSwagger } from './config/swagger';
import { ValidationPipe } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';
import { setupAssociations } from './associations/sequelize.associations';
import { ensureSchemaUpdates } from './database/ensure-schema';

let cachedServer: any;

async function bootstrapServer() {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured in environment variables');
    }
    const expressApp = express();
    const adapter = new ExpressAdapter(expressApp);
    
    const app = await NestFactory.create<NestExpressApplication>(AppModule, adapter, {
      logger: ['error', 'warn', 'log'],
      bufferLogs: true
    });

    // Middleware
    app.use(bodyParser.json({ limit: '50mb' }));
    app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
    app.use(cookieParser());

    // Global pipes
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    // CORS
    app.enableCors({
      origin: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    });
    // Static assets
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
      prefix: '/uploads/',
    });

    // Database setup with proper association timing
    try {
      const sequelize = app.get(Sequelize);
      console.log('Starting Lambda database sync...');
      
      // Use gentle sync - only create new tables, don't alter existing ones
      await sequelize.sync({ force: false, alter: false });
      console.log('Database sync completed successfully.');
      
      // Ensure all required columns exist using IF NOT EXISTS
      // This is safe to run every time - idempotent!
      await ensureSchemaUpdates(sequelize);
      
      // Setup associations after Sequelize sync to ensure all models are initialized
      setupAssociations();
      console.log('Sequelize associations have been set up successfully in Lambda.');
      
      // Verify database connection
      await sequelize.authenticate();
      console.log('Database connection verified.');
      
    } catch (dbError) {
      console.error('Database setup error:', dbError);
      // Don't throw here to allow Lambda to continue, but log the error
    }

    // Swagger setup
    setupSwagger(app, '/api');

    return serverlessExpress({ 
      app: expressApp,
      resolutionMode: 'PROMISE'
    });
  } catch (error) {
    console.error('Bootstrap server error:', error);
    throw error;
  }
}

export const handler = async (
  event: any,  // Changed to any to handle various event types
  context: Context,
  callback: Callback,
) => {
  console.log('Incoming Event:', JSON.stringify(event, null, 2));

  // Transform test events to proper API Gateway format
  const processedEvent = {
    ...event,
    httpMethod: event.httpMethod || 'GET',
    path: event.path || '/',
    requestContext: event.requestContext || {
      httpMethod: event.httpMethod || 'GET',
      path: event.path || '/'
    },
    headers: event.headers || {
      'Content-Type': 'application/json'
    },
    body: event.body || null,
    queryStringParameters: event.queryStringParameters || null
  };

  try {
    if (!cachedServer) {
      cachedServer = await bootstrapServer();
    }
    
    const result = await cachedServer(processedEvent, context, callback);
    return result;
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ 
        message: 'Internal Server Error',
        error: error.message,
        stack: process.env.NODE_ENV === 'production' ? undefined : error.stack
      }),
      headers: {
        'Content-Type': 'application/json'
      }
    };
  }
};