/** Remote join artifact cannot load this laptop's better-sqlite3 native addon. */
export default class Database {
  constructor() {
    throw new Error('better-sqlite3 is not available in the remote join artifact');
  }
}
