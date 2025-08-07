import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication, swaggerPath: string = '/api') {
  const config = new DocumentBuilder()
    .setTitle('Family Tree API')
    .setDescription('The API for Family Tree MVP')
    .setVersion('1.0')
    .addBearerAuth()
    .addServer(swaggerPath) // 👈 dynamic server path for Swagger
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(swaggerPath.replace(/^\//, ''), app, document, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
