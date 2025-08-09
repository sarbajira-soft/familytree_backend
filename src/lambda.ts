import { Context, Callback, APIGatewayProxyEvent } from 'aws-lambda';
import createServer from '@vendia/serverless-express';
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

  const adapter = new ExpressAdapter(expressApp);
  const app = await NestFactory.create<NestExpressApplication>(AppModule, adapter);

  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  app.use(cookieParser());

  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }));

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

  setupSwagger(app, '/api');

  await app.init();

  return createServer({ app: expressApp });
}

export const handler = async (
  event: APIGatewayProxyEvent,
  context: Context,
  callback: Callback,
) => {
  if (!server) {
    server = await bootstrapServer();
  }
  return server(event, context, callback);
};
