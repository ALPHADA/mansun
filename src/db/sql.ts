import { sql, type SQL } from "drizzle-orm";
import { getTableName, type AnyColumn, type Table } from "drizzle-orm";

/**
 * 상관 서브쿼리 안에서 바깥 테이블 컬럼을 참조할 때 사용.
 * drizzle은 select 대상 테이블의 컬럼을 비한정("id")으로 렌더링하므로 서브쿼리 내부 alias와 충돌한다.
 */
export function outer(table: Table, column: AnyColumn): SQL {
  return sql.raw(`"${getTableName(table)}"."${column.name}"`);
}
