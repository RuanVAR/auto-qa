import { Global, Module } from '@nestjs/common';
import { EnvAccessService } from './env-access.service';

/**
 * Global module so any feature module can inject EnvAccessService without
 * adding it to its own imports list. Access control is cross-cutting; making
 * it global keeps controllers focused on their own domain logic.
 */
@Global()
@Module({
  providers: [EnvAccessService],
  exports: [EnvAccessService],
})
export class AccessModule {}
