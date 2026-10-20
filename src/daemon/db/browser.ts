import { PrismaManager } from './prisma';

export const ALLOWED_TABLES = [
  'users',
  'api_keys',
  'refresh_tokens',
  'services',
  'routes',
  'system_settings',
  'system_configs',
  'audit_logs_v2',
  'audit_logs',
] as const;

export type AllowedTable = typeof ALLOWED_TABLES[number];

export class TableBrowser {
  private prismaManager: PrismaManager;

  constructor(prismaManager: PrismaManager) {
    this.prismaManager = prismaManager;
  }

  public getPermittedTables(): string[] {
    return [...ALLOWED_TABLES];
  }

  public async queryTable(
    table: string,
    options: {
      page?: number;
      pageSize?: number;
      orderBy?: string;
      orderDir?: 'asc' | 'desc';
    } = {}
  ): Promise<{ rows: any[]; totalCount: number; page: number; pageSize: number; columns: string[] }> {
    if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
      throw new Error(`Table '${table}' is not permitted for table browsing.`);
    }

    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(100, Math.max(1, options.pageSize || 25));
    const offset = (page - 1) * pageSize;
    const orderDir = options.orderDir === 'desc' ? 'DESC' : 'ASC';

    const client = this.prismaManager.getClient();

    // Enforce read-only transaction with statement timeout (5 seconds)
    return await client.$transaction(async (tx) => {
      // Set read-only session and strict statement timeout
      await tx.$executeRawUnsafe(`SET LOCAL default_transaction_read_only = on; SET LOCAL statement_timeout = 5000;`);

      // Safe parameterized queries using allow-listed table identifier
      const safeTable = `"${table.replace(/"/g, '')}"`;

      // Get total count
      const countRes: any = await tx.$queryRawUnsafe(`SELECT count(*)::int as count FROM ${safeTable}`);
      const totalCount = countRes[0]?.count ?? 0;

      // Validate orderBy column to prevent SQL injection in sort
      let orderClause = '';
      if (options.orderBy) {
        const cleanOrderCol = options.orderBy.replace(/[^a-zA-Z0-9_]/g, '');
        if (cleanOrderCol) {
          orderClause = `ORDER BY "${cleanOrderCol}" ${orderDir}`;
        }
      }

      // Fetch paginated rows
      const query = `SELECT * FROM ${safeTable} ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
      const rows: any = await tx.$queryRawUnsafe(query);

      // Mask sensitive columns before returning
      const sanitizedRows = rows.map((r: any) => {
        const copy = { ...r };
        if (copy.passwordHash) copy.passwordHash = '[PROTECTED_ARGON2_HASH]';
        if (copy.keyHash) copy.keyHash = '[PROTECTED_HASH]';
        if (copy.tokenHash) copy.tokenHash = '[PROTECTED_HASH]';
        return copy;
      });

      const columns = sanitizedRows.length > 0 ? Object.keys(sanitizedRows[0]) : [];

      return {
        rows: sanitizedRows,
        totalCount,
        page,
        pageSize,
        columns,
      };
    });
  }
}
