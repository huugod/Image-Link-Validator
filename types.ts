
// Fix: Added TableName type to enforce valid table names and updated Item interface.
export type TableName = 'avatars' | 'beast_eggs' | 'divine_beasts' | 'equipment' | 'herbs' | 'pills';

export enum ItemStatus {
  IDLE = 'IDLE',
  CHECKING = 'CHECKING',
  OK = 'OK',
  ERROR = 'ERROR',
}

export interface Item {
  internalId: string; // Unique ID for React rendering
  id: string;           // Original ID from the database table
  tableName: TableName;
  name: string;
  description: string;
  url: string;
  status: ItemStatus;
  originalLine: string; // The full original VALUES line from the SQL file
  subKey?: string | number; // For distinguishing items from a single line (e.g., JSON array)
}
