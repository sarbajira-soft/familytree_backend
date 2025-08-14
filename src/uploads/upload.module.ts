import { Module, forwardRef } from '@nestjs/common';
import { UploadService } from './upload.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [forwardRef(() => UserModule)],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {} 
