import { Context, Callback, APIGatewayProxyEvent } from 'aws-lambda';
import serverlessExpress from '@vendia/serverless-express';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication, ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import * as express from 'express';
import * as cookieParser from 'cookie-parser';
import * as bodyParser from 'body-parser';
import { join } from 'path';
import { setupSwagger } from './config/swagger';
import { ValidationPipe } from '@nestjs/common';
import { Sequelize } from 'sequelize-typescript';

let server: any;

async function bootstrapServer() {
  const expressApp = express();

  // Use ExpressAdapter so Nest can attach to this Express instance
  const adapter = new ExpressAdapter(expressApp);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, adapter);

  // Middlewares
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  // Validation
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

  // CORS
  app.enableCors({
    origin: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  // Static files
  app.useStaticAssets(join(__dirname, '..', 'uploads'), {
    prefix: '/uploads/',
  });

  // DB sync
  const sequelize = app.get(Sequelize);
  await sequelize.sync({ force: false, alter: true });

  // Swagger
  setupSwagger(app, '/api');

  await app.init();

  return serverlessExpress({ app: expressApp });
}

export const handler = async (event: APIGatewayProxyEvent, context: Context, callback: Callback) => {
  if (!server) {
    server = await bootstrapServer();
  }
  return server(event, context, callback);
};
