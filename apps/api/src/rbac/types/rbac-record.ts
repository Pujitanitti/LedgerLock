export interface RoleRecord {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface PermissionRecord {
  id: string;
  tenantId: string;
  action: string;
  createdAt: Date;
}

export interface InheritanceEdgeRecord {
  parentRoleId: string;
  childRoleId: string;
}
