import { Controller, Get, Put, Delete, Post, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';
import { AcLinksService } from './ac-links.service';

class SetAcSourceDto {
  @IsString() installId: string;
  @IsString() docId: string;
  @IsString() pageId: string;
  @IsOptional() @IsString() sectionSlug?: string | null;
  @IsOptional() @IsString() pageTitle?: string | null;
  @IsOptional() @IsString() sectionTitle?: string | null;
  @IsOptional() @IsString() itemFingerprint?: string | null;
  @IsOptional() @IsString() itemTitle?: string | null;
  @IsString() externalUrl: string;
}

class ListSectionsDto {
  @IsString() installId: string;
  @IsString() docId: string;
  @IsString() pageId: string;
}

class ListItemsDto {
  @IsString() installId: string;
  @IsString() docId: string;
  @IsString() pageId: string;
  @IsOptional() @IsString() sectionSlug?: string | null;
}

@ApiTags('ac-links') @ApiBearerAuth()
@Controller('tests/:testId/ac-source')
export class AcLinksController {
  constructor(private readonly service: AcLinksService) {}

  @Get() @ApiOperation({ summary: 'Get the AC source link for a test' })
  get(@Param('testId') testId: string) {
    return this.service.getLink(testId);
  }

  @Put() @ApiOperation({ summary: 'Set or replace the AC source link for a test' })
  set(@Param('testId') testId: string, @Body() dto: SetAcSourceDto) {
    return this.service.setLink(testId, {
      installId: dto.installId,
      docId: dto.docId,
      pageId: dto.pageId,
      sectionSlug: dto.sectionSlug ?? null,
      pageTitle: dto.pageTitle ?? null,
      sectionTitle: dto.sectionTitle ?? null,
      itemFingerprint: dto.itemFingerprint ?? null,
      itemTitle: dto.itemTitle ?? null,
      externalUrl: dto.externalUrl,
    });
  }

  @Delete() @ApiOperation({ summary: 'Unlink the AC source from a test' })
  unlink(@Param('testId') testId: string) {
    return this.service.unlink(testId);
  }

  @Post('sync') @ApiOperation({ summary: 'Fetch latest content from ClickUp; does not modify test description' })
  sync(@Param('testId') testId: string) {
    return this.service.sync(testId);
  }

  @Post('apply') @ApiOperation({ summary: 'Apply the most recent synced content to the test description' })
  apply(@Param('testId') testId: string) {
    return this.service.apply(testId);
  }

  @Post('undo') @ApiOperation({ summary: 'Undo the most recent Apply (24h window)' })
  undo(@Param('testId') testId: string) {
    return this.service.undo(testId);
  }

  @Post('sections') @ApiOperation({ summary: 'List headings of a candidate ClickUp doc page for the picker' })
  listSections(@Param('testId') _testId: string, @Body() dto: ListSectionsDto) {
    return this.service.listPageSections(_testId, dto);
  }

  @Post('section-items') @ApiOperation({ summary: 'List top-level numbered/bulleted items inside a section' })
  listSectionItems(@Param('testId') _testId: string, @Body() dto: ListItemsDto) {
    return this.service.listSectionItems(_testId, {
      installId: dto.installId,
      docId: dto.docId,
      pageId: dto.pageId,
      sectionSlug: dto.sectionSlug ?? null,
    });
  }
}
