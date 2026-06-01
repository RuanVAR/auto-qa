import { Global, Module } from '@nestjs/common';
import { PlatformBrandingService } from './platform-branding.service';

/**
 * Global so auth (public /config), admin (get/set), reports (PDF header) and
 * email (brand resolution) can all inject PlatformBrandingService without
 * importing this module explicitly.
 */
@Global()
@Module({
  providers: [PlatformBrandingService],
  exports: [PlatformBrandingService],
})
export class PlatformBrandingModule {}
