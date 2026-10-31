import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

const connections = new Map<string, ReturnType<typeof connect>>();
function connect(url: string) {
  const sql = new SQL(url, { max: 4, connectionTimeout: 2 });
  return { sql, db: drizzle({ client: sql, schema }) };
}
export function db(url: string) {
  let connection = connections.get(url);
  if (!connection) {
    connection = connect(url);
    connections.set(url, connection);
  }
  return connection;
}
export async function closeDb(url: string) {
  const connection = connections.get(url);
  if (connection) {
    connections.delete(url);
    await connection.sql.close();
  }
}
