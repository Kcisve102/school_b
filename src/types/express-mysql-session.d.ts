declare module 'express-mysql-session' {
  import session from 'express-session';
  import { Pool, PoolOptions } from 'mysql2/promise';

  interface Options extends PoolOptions {
    clearExpired?: boolean;
    checkExpirationInterval?: number;
    expiration?: number;
    createDatabaseTable?: boolean;
    schema?: {
      tableName?: string;
      columnNames?: {
        session_id?: string;
        expires?: string;
        data?: string;
      };
    };
  }

  function MySQLStoreConstructor(session: typeof import('express-session')): {
    new (options: Options): session.Store;
  };

  export = MySQLStoreConstructor;
}
