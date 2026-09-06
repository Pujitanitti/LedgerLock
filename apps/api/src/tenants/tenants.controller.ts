import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantProvisionResponseDto } from './dto/tenant-response.dto';
import { toTenantResponse } from './dto/tenant-response.mapper';
import { toApiKeyCreatedResponse } from '../auth/dto/api-key-response.mapper';
import { TenantProvisioningRateLimitGuard } from './guards/tenant-provisioning-rate-limit.guard';

@ApiTags('tenants')
@Controller({ path: 'tenants', version: '1' })
export class TenantsController {
  constructor(private readonly provisioning: TenantProvisioningService) {}

  /**
   * KNOWN LIMITATION, FLAGGED DELIBERATELY (not hidden): this endpoint is
   * unauthenticated by necessity — a brand-new tenant has no API key yet
   * to authenticate with. Tracked formally as risk R-001 in
   * docs/risk-register.md and docs/decisions/ADR-008-unauthenticated-tenant-provisioning.md.
   *
   * PRODUCTION-READINESS WARNING: do not deploy to any environment
   * reachable by untrusted parties while this remains unauthenticated.
   * Anyone who can reach this endpoint can create a tenant and a working
   * API key for it right now — a rate limit (below) throttles this, but
   * does NOT add legitimacy checking, and does not stop a distributed
   * attacker rotating IPs.
   *
   * TenantProvisioningRateLimitGuard is the "at minimum rate limiting +
   * abuse monitoring" step ADR-008 named as the near-term mitigation —
   * it is a PARTIAL mitigation, not a fix, and R-001 remains OPEN. This
   * is intentionally NOT closed by inventing a platform-admin system
   * here — see ADR-008 for why that would be speculative infrastructure
   * built to make a finding look resolved rather than a real fix.
   */
  @Post()
  @UseGuards(TenantProvisioningRateLimitGuard)
  @ApiOperation({
    summary: 'Provision a new tenant and its first API key.',
    description:
      'UNAUTHENTICATED bootstrap endpoint, rate-limited per source IP (see ADR-008 / risk register R-001). ' +
      'The returned rawKey is shown exactly once and cannot be retrieved again.',
  })
  @ApiResponse({ status: 201, type: TenantProvisionResponseDto })
  @ApiResponse({ status: 409, description: 'A tenant with this slug already exists.' })
  @ApiResponse({ status: 429, description: 'Too many tenant-creation attempts from this source.' })
  async create(@Body() dto: CreateTenantDto): Promise<TenantProvisionResponseDto> {
    const { tenant, apiKey } = await this.provisioning.provisionTenant(dto);
    return {
      tenant: toTenantResponse(tenant),
      apiKey: toApiKeyCreatedResponse(apiKey.record, apiKey.rawKey),
    };
  }
}
