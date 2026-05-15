import { Global, Module } from '@nestjs/common';
import { SecretsService } from './secrets.service';

// Global so any feature module can inject SecretsService without re-importing.
// Plugin install secrets, org AI credentials, and any future encrypted blobs
// all share this single AES-256-GCM envelope + KEK rotation pipeline.
@Global()
@Module({
  providers: [SecretsService],
  exports: [SecretsService],
})
export class SecretsModule {}
