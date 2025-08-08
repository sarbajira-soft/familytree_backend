import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { INestApplication } from '@nestjs/common';

export function setupSwagger(app: INestApplication, swaggerPath: string = '/api') {
  const config = new DocumentBuilder()
    .setTitle('Family Tree API')
    .setDescription('The API for Family Tree MVP')
    .setVersion('1.0')
    .addBearerAuth()
<<<<<<< HEAD
    .addServer(swaggerPath) // dynamic server path for Swagger
=======
    .addServer(swaggerPath) // 👈 dynamic server path for Swagger
>>>>>>> fa20b5721992d820e302d3d2fc2499aeea5908fb
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(swaggerPath.replace(/^\//, ''), app, document, {
    swaggerOptions: {
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });
}
