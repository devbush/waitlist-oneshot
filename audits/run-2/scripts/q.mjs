import { DatabaseSync } from 'node:sqlite';
const [, , file, sql, mode] = process.argv;
const db = new DatabaseSync(file);
if (mode === 'exec') { db.exec(sql); console.log('exec ok'); }
else for (const r of db.prepare(sql).all()) console.log(JSON.stringify(r));
db.close();
