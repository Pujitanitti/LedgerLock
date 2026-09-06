import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateRoleDto {
  @ApiProperty({ example: 'Admin' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}

export class CreatePermissionDto {
  @ApiProperty({ example: 'projects:delete', description: 'resource:action format.' })
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*:[a-z][a-z0-9_]*$/, {
    message: 'action must be in "resource:action" format, e.g. "projects:delete"',
  })
  action!: string;
}

export class AssignPermissionDto {
  @ApiProperty({ example: 'perm_abc123' })
  @IsString()
  permissionId!: string;
}

export class AddInheritanceDto {
  @ApiProperty({ example: 'role_admin_id', description: 'The role this role should inherit permissions from.' })
  @IsString()
  parentRoleId!: string;
}

export class AssignRoleDto {
  @ApiProperty({ example: 'role_abc123' })
  @IsString()
  roleId!: string;
}
