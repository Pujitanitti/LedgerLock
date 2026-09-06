import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { TenantsModule } from '../tenants/tenants.module';
import { RbacModule } from '../rbac/rbac.module';
import { PoliciesModule } from '../policies/policies.module';
import { AuditModule } from '../audit/audit.module';
import { AuthorizationController } from './authorization.controller';
import { DecisionEngineService } from './decision-engine/decision-engine.service';
import { PolicyEvaluationService } from './policy-engine/policy-evaluation.service';
import { DECISION_CACHE } from './decision-cache/decision-cache.port';
import { RedisDecisionCache } from './decision-cache/redis-decision-cache';

@Module({
  // UsersModule, RbacModule, PoliciesModule, and TenantsModule are
  // imported for their exported repository tokens (USER_REPOSITORY,
  // RBAC_REPOSITORY, POLICY_REPOSITORY, TENANT_REPOSITORY) --
  // DecisionEngineService and PolicyEvaluationService depend on those
  // ports directly, not on the higher-level management services, since
  // the check hot-path needs raw lookups rather than management-API
  // -shaped operations. AuditModule provides the outbox-backed audit
  // pipeline (Phase 6).
  imports: [AuthModule, UsersModule, TenantsModule, RbacModule, PoliciesModule, AuditModule],
  controllers: [AuthorizationController],
  providers: [
    DecisionEngineService,
    PolicyEvaluationService,
    { provide: DECISION_CACHE, useClass: RedisDecisionCache },
  ],
})
export class AuthorizationModule {}
