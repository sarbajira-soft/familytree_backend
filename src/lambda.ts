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

let cachedServer: any;

async function bootstrapServer() {
  try {
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

    // CORS - configure properly for your needs
    app.enableCors({
      origin: true,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    });

    // Static assets
    app.useStaticAssets(join(process.cwd(), 'uploads'), {
      prefix: '/uploads/',
    });

    // Database sync - consider moving this to a separate Lambda or startup script
    // const sequelize = app.get(Sequelize);
    // await sequelize.sync({ alter: true }).catch(err => {
    //   console.error('Database sync error:', err);
    // });

    // Swagger setup
    setupSwagger(app, '/api');

    await app.init();

    // Return the serverless-express handler
    return serverlessExpress({ 
      app: expressApp,
      resolutionMode: 'PROMISE' // Important for async handling
    });
  } catch (error) {
    console.error('Bootstrap server error:', error);
    throw error;
  }
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback,
) => {
  // Log incoming event for debugging
  console.log('Incoming Lambda Event:', JSON.stringify(event, null, 2));

  try {
    if (!cachedServer) {
      cachedServer = await bootstrapServer();
    }
    return cachedServer(event, context, callback);
  } catch (error) {
    console.error('Lambda handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Internal Server Error' }),
    };
  }
};