export interface Warehouse {
  id: string;
  name: string;
  location?: string;
  createdAt: any;
}

export type InputMode = 'PCS' | 'CARTON';

export interface SKU {
  id: string; // Logical SKU ID (code)
  internalId?: string; // Firestore document ID
  name: string;
  currentStock: number;
  returnStock?: number;
  holdStock?: number;
  brokenStock?: number;
  totalMasuk?: number;
  totalKeluar?: number;
  threshold?: number;
  pcsPerCarton?: number;
  cartonSizes?: number[];
  detailedStock?: Record<string, number | { total: number; boxes: number }>;
  lastUpdated?: any;
  warehouseId: string;
}

export type TransactionType = 'SCAN' | 'MASUK' | 'KELUAR' | 'RETUR' | 'INSPEKSI';

export interface Transaction {
  id?: string;
  skuId: string;
  skuName: string;
  type: TransactionType;
  quantity: number;
  date: string;
  receiptId?: string;
  reason?: string;
  inputMode?: InputMode;
  pcsPerCarton?: number;
  createdAt: any;
  updatedAt: any;
  _source?: string;
  warehouseId: string;
}

export interface Summary {
  id?: string;
  skuId: string;
  skuName: string;
  date?: string;
  month?: string;
  year?: string;
  masuk: number;
  keluar: number;
  stok: number;
  updatedAt: any;
  warehouseId: string;
}
