import { Module } from '@nestjs/common';
import { CodeIndexRequestService } from './code-index-request.service';
import { CodebaseRetrievalService } from './codebase-retrieval.service';
import { CodeIndexRefreshCron } from './code-index-refresh.cron';

@Module({
  providers: [
    CodeIndexRequestService,
    CodebaseRetrievalService,
    CodeIndexRefreshCron,
  ],
  exports: [CodeIndexRequestService, CodebaseRetrievalService],
})
export class CodebaseIndexingModule {}
