// D1 SessionテストでOwner単位Snapshot行のread / Version CAS writeだけを再現する最小Fake。
export class FakeD1 {
  private readonly rows = new Map<
    string,
    { version: number; stateJson: string; updatedAt: number }
  >();

  prepare(_query: string) {
    let values: unknown[] = [];
    const statement = {
      bind: (...nextValues: unknown[]) => {
        values = nextValues;
        return statement;
      },
      first: async <T>() => {
        const row = this.rows.get(String(values[0]));
        return row
          ? ({ version: row.version, stateJson: row.stateJson, updatedAt: row.updatedAt } as T)
          : (null as T | null);
      },
      run: async () => {
        const [userId, version, stateJson, updatedAt, expectedVersion] = values as [
          string,
          number,
          string,
          number,
          number,
        ];
        const current = this.rows.get(userId);
        if (current && current.version !== expectedVersion) return { meta: { changes: 0 } };
        this.rows.set(userId, { version, stateJson, updatedAt });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}
