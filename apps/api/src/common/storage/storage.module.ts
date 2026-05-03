import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StorageProvider } from './storage.provider';
import { LocalStorageProvider } from './local.provider';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: StorageProvider,
      useFactory: (config: ConfigService) => {
        const provider = config.get<string>('STORAGE_PROVIDER', 'local');
        switch (provider) {
          // case 's3': return new S3StorageProvider(config);
          default: return new LocalStorageProvider(config);
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: [StorageProvider],
})
export class StorageModule {}
