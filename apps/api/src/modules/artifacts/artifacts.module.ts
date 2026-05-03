import { Module } from '@nestjs/common';
import { ArtifactsController, ArtifactsDirectController } from './artifacts.controller';
import { ArtifactsService } from './artifacts.service';
@Module({ controllers: [ArtifactsController, ArtifactsDirectController], providers: [ArtifactsService], exports: [ArtifactsService] })
export class ArtifactsModule {}
