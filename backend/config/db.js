import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '../data');

// Ensure data directory exists
try {
  mkdirSync(dataDir, { recursive: true });
} catch (err) {
  // Directory already exists
}

const file = join(dataDir, 'gamerooms.json');
const adapter = new JSONFile(file);
const defaultData = { gameRooms: [], users: [], meta: {} };

let db = null;

export const connectDB = async () => {
  try {
    db = new Low(adapter, defaultData);
    await db.read();

    // Initialize with default data if file is empty
    db.data ||= defaultData;
    // Backfill new collections for databases created before they existed
    db.data.gameRooms ||= [];
    db.data.users ||= [];
    db.data.meta ||= {};

    await db.write();
    console.log(`Database Connected: ${file}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

export const getDB = () => {
  if (!db) {
    throw new Error('Database not initialized. Call connectDB() first.');
  }
  return db;
};
