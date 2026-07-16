import { IsArray, IsEmail, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrgRole, ProjectRole } from '@prisma/client';

/**
 * Pre-scoped project assignment baked into an invite. When the invitee
 * accepts, a ProjectMember row is auto-created with the listed role +
 * env restrictions — admins can onboard a UAT tester to "TWAK Project,
 * UAT env only" in one step instead of three.
 */
export class InviteProjectAssignmentDto {
  @ApiProperty() @IsString() projectId!: string;
  @ApiProperty({ enum: ProjectRole }) @IsEnum(ProjectRole) role!: ProjectRole;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() allowedEnvironmentIds?: string[];
}

export class InviteMemberDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional({ enum: OrgRole }) @IsEnum(OrgRole) @IsOptional() role?: OrgRole;

  /**
   * Accepted from the invite form but not persisted — OrgInvite has no name
   * column and the invitee sets their own name at signup. Declared so the
   * global forbidNonWhitelisted ValidationPipe doesn't 400 the request.
   */
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiPropertyOptional({ type: [InviteProjectAssignmentDto], description: 'Pre-scoped project + env access. Applied on invite accept.' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InviteProjectAssignmentDto)
  projectAssignments?: InviteProjectAssignmentDto[];
}
