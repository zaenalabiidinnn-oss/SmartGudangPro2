import { db } from './firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

export async function bootstrapDemoWarehouse() {
  try {
    // 1. Check if 'gudang-demo' already exists
    const docRef = doc(db, 'warehouses', 'gudang-demo');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      console.log('Demo warehouse already exists, skipping bootstrap');
      return;
    }

    console.log('Bootstrapping Demo Warehouse...');
    
    // 2. Create the warehouse document
    await setDoc(docRef, {
      id: 'gudang-demo',
      name: 'Gudang Demo (Sample)',
      location: 'Jakarta Selatan',
      createdAt: new Date().toISOString()
    });

    // 3. Create Sample SKUs
    const sampleSKUs = [
      {
        id: 'SKU-01',
        name: 'Indomie Goreng Spesial',
        currentStock: 1200,
        threshold: 200,
        pcsPerCarton: 40,
        detailedStock: { "40": { total: 1200, boxes: 30 } },
        totalMasuk: 1500,
        totalKeluar: 300,
        warehouseId: 'gudang-demo',
        createdAt: new Date('2026-05-20T00:00:00Z').toISOString(),
        lastUpdated: new Date('2026-05-29T00:00:00Z').toISOString()
      },
      {
        id: 'SKU-02',
        name: 'Minyak Goreng Bimoli 2L',
        currentStock: 450,
        threshold: 80,
        pcsPerCarton: 6,
        detailedStock: { "6": { total: 450, boxes: 75 } },
        totalMasuk: 600,
        totalKeluar: 150,
        warehouseId: 'gudang-demo',
        createdAt: new Date('2026-05-20T00:00:00Z').toISOString(),
        lastUpdated: new Date('2026-05-29T00:00:00Z').toISOString()
      },
      {
        id: 'SKU-03',
        name: 'Kopi Kapal Api 165g',
        currentStock: 80,
        threshold: 150,
        pcsPerCarton: 20,
        detailedStock: { "20": { total: 80, boxes: 4 } },
        totalMasuk: 400,
        totalKeluar: 320,
        warehouseId: 'gudang-demo',
        createdAt: new Date('2026-05-20T00:00:00Z').toISOString(),
        lastUpdated: new Date('2026-05-29T00:00:00Z').toISOString()
      },
      {
        id: 'SKU-04',
        name: 'Susu Frisian Flag 370g',
        currentStock: 2544,
        threshold: 300,
        pcsPerCarton: 48,
        detailedStock: { "48": { total: 2544, boxes: 53 } },
        totalMasuk: 3000,
        totalKeluar: 456,
        warehouseId: 'gudang-demo',
        createdAt: new Date('2026-05-20T00:00:00Z').toISOString(),
        lastUpdated: new Date('2026-05-29T00:00:00Z').toISOString()
      }
    ];

    for (const sku of sampleSKUs) {
      const nameSlug = sku.name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 50);
      const internalId = `gudang-demo_${sku.id}_${nameSlug}`;
      await setDoc(doc(db, 'skus', internalId), sku);
    }

    // 4. Create Sample Transaction History (to fill History logs beautifully)
    // Masuk Transactions
    const sampleMasuk = [
      {
        skuId: 'SKU-01',
        skuName: 'Indomie Goreng Spesial',
        type: 'MASUK',
        _source: 'MASUK',
        quantity: 1500,
        date: '2026-05-24',
        receiptId: 'RCV-001',
        reason: 'Restock Mingguan',
        pcsPerCarton: 40,
        createdAt: new Date('2026-05-24T08:00:00Z').toISOString(),
        updatedAt: new Date('2026-05-24T08:00:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      },
      {
        skuId: 'SKU-02',
        skuName: 'Minyak Goreng Bimoli 2L',
        type: 'MASUK',
        _source: 'MASUK',
        quantity: 600,
        date: '2026-05-24',
        receiptId: 'RCV-002',
        reason: 'Restock Mingguan',
        pcsPerCarton: 6,
        createdAt: new Date('2026-05-24T08:30:00Z').toISOString(),
        updatedAt: new Date('2026-05-24T08:30:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      },
      {
        skuId: 'SKU-03',
        skuName: 'Kopi Kapal Api 165g',
        type: 'MASUK',
        _source: 'MASUK',
        quantity: 400,
        date: '2026-05-25',
        receiptId: 'RCV-003',
        reason: 'Restock Bulanan',
        pcsPerCarton: 20,
        createdAt: new Date('2026-05-25T09:00:00Z').toISOString(),
        updatedAt: new Date('2026-05-25T09:00:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      },
      {
        skuId: 'SKU-04',
        skuName: 'Susu Frisian Flag 370g',
        type: 'MASUK',
        _source: 'MASUK',
        quantity: 3000,
        date: '2026-05-25',
        receiptId: 'RCV-004',
        reason: 'Restock Bulanan',
        pcsPerCarton: 48,
        createdAt: new Date('2026-05-25T09:45:00Z').toISOString(),
        updatedAt: new Date('2026-05-25T09:45:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      }
    ];

    // Keluar Transactions
    const sampleKeluar = [
      {
        skuId: 'SKU-01',
        skuName: 'Indomie Goreng Spesial',
        type: 'SPECIAL',
        _source: 'KELUAR',
        quantity: 300,
        date: '2026-05-27',
        receiptId: 'INV-101',
        reason: 'Kirim ke Toko Cabang',
        pcsPerCarton: 40,
        createdAt: new Date('2026-05-27T10:00:00Z').toISOString(),
        updatedAt: new Date('2026-05-27T10:00:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      },
      {
        skuId: 'SKU-02',
        skuName: 'Minyak Goreng Bimoli 2L',
        type: 'SPECIAL',
        _source: 'KELUAR',
        quantity: 150,
        date: '2026-05-27',
        receiptId: 'INV-102',
        reason: 'Kirim ke Toko Cabang',
        pcsPerCarton: 6,
        createdAt: new Date('2026-05-27T11:00:00Z').toISOString(),
        updatedAt: new Date('2026-05-27T11:00:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      },
      {
        skuId: 'SKU-03',
        skuName: 'Kopi Kapal Api 165g',
        type: 'SCAN KELUAR',
        _source: 'KELUAR',
        quantity: 320,
        date: '2026-05-28',
        receiptId: 'INV-103',
        reason: 'Rapid Scan Outbound',
        pcsPerCarton: 20,
        createdAt: new Date('2026-05-28T14:20:00Z').toISOString(),
        updatedAt: new Date('2026-05-28T14:20:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      },
      {
        skuId: 'SKU-04',
        skuName: 'Susu Frisian Flag 370g',
        type: 'SPECIAL',
        _source: 'KELUAR',
        quantity: 456,
        date: '2026-05-28',
        receiptId: 'INV-104',
        reason: 'Penjualan Grosir',
        pcsPerCarton: 48,
        createdAt: new Date('2026-05-28T16:00:00Z').toISOString(),
        updatedAt: new Date('2026-05-28T16:00:00Z').toISOString(),
        warehouseId: 'gudang-demo'
      }
    ];

    // Write Masuk
    for (const record of sampleMasuk) {
      const docId = `demo_m_${record.skuId}_${record.createdAt.replace(/[^a-zA-Z0-9]/g, '')}`;
      await setDoc(doc(db, 'history/masuk/records', docId), record);
    }

    // Write Keluar
    for (const record of sampleKeluar) {
      const docId = `demo_k_${record.skuId}_${record.createdAt.replace(/[^a-zA-Z0-9]/g, '')}`;
      await setDoc(doc(db, 'history/keluar/records', docId), record);
    }

    console.log('Bootstrapping Demo Warehouse completed successfully!');
  } catch (err) {
    console.error('Unhandled error bootstrapping demo warehouse: ', err);
  }
}
