import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditOutboxProcessorService } from './audit-outbox-processor.service';
import { AUDIT_OUTBOX_REPOSITORY } from './repositories/audit-outbox-repository.port';
import { PrismaAuditOutboxRepository } from './repositories/prisma-audit-outbox.repository';

@Module({
  providers: [
    AuditService,
    AuditOutboxProcessorService,
    { provide: AUDIT_OUTBOX_REPOSITORY, useClass: PrismaAuditOutboxRepository },
  ],
  exports: [AuditService, AuditOutboxProcessorService],
})
export class AuditModule {}
