import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';

/**
 * Global so any feature module (auth, organisations, reports, …) can inject
 * EmailService without importing this module explicitly. Email is a
 * cross-cutting concern; making it global keeps the wiring in feature
 * modules focused on domain logic.
 */
@Global()
@Module({
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}
