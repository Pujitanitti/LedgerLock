import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { CreateUserInput, UserRecord } from '../types/user-record';
import type { UserRepositoryPort } from './user-repository.port';

/**
 * VERIFICATION STATUS UPDATE: this file was written and typechecked only
 * against this project's pre-generation Prisma stub (where the whole
 * client resolves to `any`), same as every other Prisma-touching file —
 * but unlike the others, it returned Prisma's raw query result directly
 * instead of mapping through an explicit function first. Once run
 * against a REAL generated Prisma Client (on a machine with working
 * network access to binaries.prisma.sh), this surfaced a genuine type
 * error: Prisma's generated type for a `Json` column is a JSON value —
 * which per the JSON spec can be a string, number, boolean, or array,
 * not just an object — and that's wider than this project's domain type
 * for `User.attributes` (`Record<string, unknown> | null`), so it isn't
 * structurally assignable without an explicit boundary. Every other
 * Prisma repository in this project (`PrismaPolicyRepository`,
 * `PrismaAuditOutboxRepository`) already routes Json-column fields
 * through an `unknown`-typed intermediate with an explicit cast at the
 * boundary for exactly this reason — this file now does too, via
 * `toUserRecord`/`toJsonInput` below. `unknown` is used deliberately
 * instead of naming `Prisma.JsonValue`/`Prisma.InputJsonValue` directly:
 * those specific named types are (unlike `Prisma.TransactionClient`) not
 * declared at all in this sandbox's pre-generation stub, so referencing
 * them by name can't be typechecked here even though they exist on a
 * real generated client — the `unknown`-cast pattern already proven
 * elsewhere in this codebase avoids depending on that at all.
 */
@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateUserInput): Promise<UserRecord> {
    const record = await this.prisma.user.create({
      data: {
        tenantId: input.tenantId,
        externalId: input.externalId,
              attributes: toJsonInput(input.attributes) as never,
      },
    });
    return toUserRecord(record);
  }

  async findByExternalId(tenantId: string, externalId: string): Promise<UserRecord | null> {
    const record = await this.prisma.user.findUnique({
      where: { tenantId_externalId: { tenantId, externalId } },
    });
    return record ? toUserRecord(record) : null;
  }

  async findById(tenantId: string, id: string): Promise<UserRecord | null> {
    const record = await this.prisma.user.findFirst({ where: { id, tenantId } });
    return record ? toUserRecord(record) : null;
  }

  async findManyByExternalIds(tenantId: string, externalIds: readonly string[]): Promise<UserRecord[]> {
    if (externalIds.length === 0) return [];
    const records = await this.prisma.user.findMany({
      where: { tenantId, externalId: { in: [...externalIds] } },
    });
    return records.map(toUserRecord);
  }

  async list(tenantId: string): Promise<UserRecord[]> {
    const records = await this.prisma.user.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    return records.map(toUserRecord);
  }

  async incrementAuthzVersion(tenantId: string, userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, tenantId },
      data: { authzVersion: { increment: 1 } },
    });
  }
}

/**
 * Prisma's raw row has a JSON-typed `attributes` field — per the JSON
 * spec that could be a string/number/boolean/array too, not just an
 * object. This project's domain type is deliberately narrower (an
 * object or nothing at all), since that's the only shape ABAC subject
 * attributes are ever meant to be (see SubjectAttributes). If a
 * non-object JSON value somehow ended up in the column — it shouldn't,
 * since `create` only ever writes a plain object or nothing — this
 * treats it as `null` rather than propagating a shape the rest of the
 * app never expects.
 */
function toUserRecord(record: {
  id: string;
  tenantId: string;
  externalId: string;
  authzVersion: number;
  attributes: unknown;
  createdAt: Date;
}): UserRecord {
  const attributes =
    record.attributes !== null && typeof record.attributes === 'object' && !Array.isArray(record.attributes)
      ? (record.attributes as Record<string, unknown>)
      : null;

  return {
    id: record.id,
    tenantId: record.tenantId,
    externalId: record.externalId,
    authzVersion: record.authzVersion,
    attributes,
    createdAt: record.createdAt,
  };
}

/** The write-side inverse: our domain type -> whatever Prisma expects for a `Json?` column's create input. */
function toJsonInput(attributes: Record<string, unknown> | undefined): unknown {
  return attributes ?? undefined;
}