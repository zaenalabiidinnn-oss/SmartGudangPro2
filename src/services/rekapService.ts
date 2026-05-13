import { 
  collection, 
  doc, 
  writeBatch, 
  serverTimestamp, 
  increment, 
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  limit
} from 'firebase/firestore';
import { db } from '../lib/firebase';
import { OperationType, handleFirestoreError } from '../lib/errorHandlers';
import { TransactionType } from '../types';

// Helper to remove undefined fields while preserving Firestore FieldValues
const cleanData = (obj: any) => {
  const result: any = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== undefined) {
      result[key] = obj[key];
    }
  });
  return result;
};

// Helper to find SKU document by trying both prefixed and non-prefixed ID
const findSku = async (warehouseId: string, skuId: string) => {
  const cleanId = skuId.trim();
  // 1. Try prefixed ID (Standard format)
  const logicalId = cleanId.startsWith(warehouseId + '_') 
    ? cleanId.substring(warehouseId.length + 1) 
    : cleanId;
  const internalId = `${warehouseId}_${logicalId}`;
  
  const ref1 = doc(db, 'skus', internalId);
  const snap1 = await getDoc(ref1);
  if (snap1.exists()) return { ref: ref1, snap: snap1, internalId };

  // 2. Try raw ID (Legacy or direct format)
  const ref2 = doc(db, 'skus', cleanId);
  const snap2 = await getDoc(ref2);
  if (snap2.exists()) {
    const data = snap2.data();
    // Only accept if warehouseId matches
    if (data.warehouseId === warehouseId) {
      return { ref: ref2, snap: snap2, internalId: cleanId };
    }
  }

  return { ref: null, snap: null, internalId: null };
};

export const processTransaction = async (
  type: TransactionType,
  data: {
    skuId: string;
    quantity: number;
    receiptId?: string;
    reason?: string;
    date: string;
    warehouseId: string;
    pcsPerCarton?: number;
    isBrokenStockKeluar?: boolean;
  }
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  try {
    // 1. SKU document lookup
    const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId);
    
    if (!skuRef || !skuSnap || !skuSnap.exists()) {
      console.error(`[processTransaction] SKU MISSING: ${data.skuId} in warehouse ${data.warehouseId}`);
      throw new Error('SKU tidak ditemukan di gudang ini');
    }

    const skuData = skuSnap.data();
    const skuName = skuData.name;

    // 1. Transaction Record
    let targetPath = '';
    if (type === 'MASUK') targetPath = 'history/masuk/records';
    else if (type === 'KELUAR') targetPath = 'history/keluar/records';
    else if (type === 'RETUR') targetPath = 'history/retur/records';
    else targetPath = 'history/keluar/records'; // fallback for 'SCAN'

    // Determine internal type for log
    let logType = type as string;
    if (type === 'SCAN') logType = 'SCAN KELUAR';
    if (type === 'MASUK') logType = 'MASUK';
    if (type === 'KELUAR') logType = 'KELUAR';
    if (type === 'RETUR') logType = 'RETUR';

    // 2. Determine which packaging size to use for breakdown
    const isOutgoing = type === 'SCAN' || type === 'KELUAR';
    const totalQuantity = data.quantity;
    
    const detailedStock = skuSnap.data()?.detailedStock || {};
    const skuPcsPerCarton = skuSnap.data()?.pcsPerCarton || 1;

    // Check if this outgoing is specifically for "RUSAK" stock (taking FROM broken pool)
    const isBrokenKeluar = isOutgoing && !!data.isBrokenStockKeluar;

    // NEW: Check if this is a "Move to Broken" action (Out from Main, In to Broken)
    // This happens when a NORMAL KELUAR (not from brokenStock pool) has "rusak" in reason
    const isMoveToBroken = !isBrokenKeluar && type === 'KELUAR' && data.reason?.toLowerCase().includes('rusak');

    let updateData: any = {
      lastUpdated: now
    };

    const logs: any[] = [];
    let remainingToProcess = totalQuantity;

    if (isOutgoing && !isBrokenKeluar) {
      // NORMAL OUTGOING LOGIC (from currentStock)
      const availableBatches = Object.entries(detailedStock as Record<string, any>)
        .map(([s, val]) => {
          const size = Number(s);
          const total = typeof val === 'object' && val !== null ? (val.total || 0) : Number(val || 0);
          const boxes = typeof val === 'object' && val !== null ? (val.boxes || 0) : Math.floor(total / size);
          return { size, total, boxes, sizeKey: s };
        })
        .filter(b => b.total > 0 || b.sizeKey === String(data.pcsPerCarton || skuPcsPerCarton));

      // Sort by total pieces ascending (lowest pieces first)
      availableBatches.sort((a, b) => {
        if (data.pcsPerCarton) {
          if (a.size === data.pcsPerCarton) return -1;
          if (b.size === data.pcsPerCarton) return 1;
        }
        return a.total - b.total;
      });

      if (availableBatches.length === 0) {
        availableBatches.push({ 
          size: data.pcsPerCarton || skuPcsPerCarton, 
          total: 0, 
          boxes: 0, 
          sizeKey: String(data.pcsPerCarton || skuPcsPerCarton) 
        });
      }

      for (const batchInfo of availableBatches) {
        if (remainingToProcess <= 0) break;

        const takeFromThisBatch = Math.min(remainingToProcess, Math.max(0, batchInfo.total));
        const actualTake = (batchInfo === availableBatches[availableBatches.length - 1]) 
          ? remainingToProcess 
          : takeFromThisBatch;

        const newTotal = batchInfo.total - actualTake;
        const newBoxes = Math.floor(Math.max(0, newTotal) / batchInfo.size);

        updateData[`detailedStock.${batchInfo.sizeKey}`] = {
          total: newTotal,
          boxes: newBoxes
        };

        logs.push({
          ...data,
          quantity: actualTake,
          pcsPerCarton: batchInfo.size,
          inputMode: data.pcsPerCarton ? 'CARTON' : 'PCS',
          skuName,
          type: logType,
          createdAt: now,
          updatedAt: now,
          warehouseId: data.warehouseId
        });

        remainingToProcess -= actualTake;
      }
      
      updateData.currentStock = increment(-totalQuantity);
      updateData.totalKeluar = increment(totalQuantity);

      // ADDED: If reason is "rusak", also move to broken stock
      if (isMoveToBroken) {
        updateData.brokenStock = increment(totalQuantity);
        
        // Also add a RETUR log so it shows up in "Stok Retur"
        const returLogRef = doc(collection(db, 'history/retur/records'));
        const returLogData = {
          ...data,
          skuName,
          type: 'RETUR',
          isAutoProcessed: true,
          reason: `Auto-Retur (Dari Data Keluar - Rusak): ${data.reason || ''}`,
          createdAt: now,
          updatedAt: now,
          inputMode: data.pcsPerCarton ? 'CARTON' : 'PCS',
          pcsPerCarton: data.pcsPerCarton || skuPcsPerCarton
        };
        batch.set(returLogRef, cleanData(returLogData));

        // Add reference to the logs being pushed
        logs.forEach(l => {
          l.autoReturLogId = returLogRef.id;
        });
      }
    } else if (isBrokenKeluar) {
      // OUTGOING FROM BROKEN STOCK
      updateData.brokenStock = increment(-totalQuantity);
      updateData.totalKeluar = increment(totalQuantity); // Still a 'keluar' transaction

      logs.push({
        ...data,
        pcsPerCarton: data.pcsPerCarton || skuPcsPerCarton,
        inputMode: data.pcsPerCarton ? 'CARTON' : 'PCS',
        skuName,
        type: logType,
        isBrokenStockKeluar: true,
        createdAt: now,
        updatedAt: now,
        warehouseId: data.warehouseId
      });
    } else {
      // INCOMING LOGIC
      const usedPcsPerCarton = data.pcsPerCarton || skuPcsPerCarton;
      const sizeKey = String(usedPcsPerCarton);
      
      if (type !== 'RETUR') {
        const currentVal = detailedStock[sizeKey];
        const prevTotal = typeof currentVal === 'object' && currentVal !== null ? (currentVal.total || 0) : Number(currentVal || 0);
        const newTotal = prevTotal + totalQuantity;
        const newBoxes = Math.floor(newTotal / usedPcsPerCarton);

        updateData.currentStock = increment(totalQuantity);
        updateData.totalMasuk = increment(totalQuantity);
        updateData[`detailedStock.${sizeKey}`] = {
          total: newTotal,
          boxes: newBoxes
        };
      } else {
        // Update returnStock in SKU
        updateData.returnStock = increment(totalQuantity);
      }

      logs.push({
        ...data,
        inputMode: data.pcsPerCarton ? 'CARTON' : 'PCS',
        pcsPerCarton: usedPcsPerCarton,
        skuName,
        type: logType,
        createdAt: now,
        updatedAt: now,
        warehouseId: data.warehouseId
      });
    }

    // Write all logs
    for (const logData of logs) {
      if (logData.quantity !== 0) {
        const newLogRef = doc(collection(db, targetPath));
        batch.set(newLogRef, cleanData(logData));
      }
    }

    // 3. Update SKU stock (only if not empty except lastUpdated)
    if (Object.keys(updateData).length > 1) {
      batch.update(skuRef, updateData);
    }

    // 4. Update Summaries (Harian, Bulanan, Tahunan) - Skip if RETUR or Broken Keluar
    if (type !== 'RETUR' && !isBrokenKeluar) {
      const dateStr = data.date; // YYYY-MM-DD
      const qtyChange = isOutgoing ? -totalQuantity : totalQuantity;
      const monthStr = dateStr.substring(0, 7); // YYYY-MM
      const yearStr = dateStr.substring(0, 4); // YYYY

      const dailyId = `${dateStr}_${internalSkuId}`;
      const monthlyId = `${monthStr}_${internalSkuId}`;
      const yearlyId = `${yearStr}_${internalSkuId}`;

      const masukIncr = isOutgoing ? 0 : data.quantity;
      const keluarIncr = isOutgoing ? data.quantity : 0;

      // Daily
      batch.set(doc(db, 'history/daily/records', dailyId), {
        skuId: data.skuId,
        skuName,
        date: dateStr,
        masuk: increment(masukIncr),
        keluar: increment(keluarIncr),
        stokAkhir: increment(qtyChange),
        updatedAt: now,
        warehouseId: data.warehouseId
      }, { merge: true });

      // Monthly
      batch.set(doc(db, 'history/monthly/records', monthlyId), {
        skuId: data.skuId,
        skuName,
        month: monthStr,
        masuk: increment(masukIncr),
        keluar: increment(keluarIncr),
        stok: increment(qtyChange),
        updatedAt: now,
        warehouseId: data.warehouseId
      }, { merge: true });

      // Yearly
      batch.set(doc(db, 'history/yearly/records', yearlyId), {
        skuId: data.skuId,
        skuName,
        year: yearStr,
        masuk: increment(masukIncr),
        keluar: increment(keluarIncr),
        stok: increment(qtyChange),
        updatedAt: now,
        warehouseId: data.warehouseId
      }, { merge: true });
    }

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `history/${type}`);
  }
};

export const deleteTransaction = async (type: TransactionType, logId: string) => {
  console.log(`Attempting to delete ${type} transaction: ${logId}`);
  const batch = writeBatch(db);
  let logPath = '';
  if (type === 'MASUK') logPath = 'history/masuk/records';
  else if (type === 'KELUAR') logPath = 'history/keluar/records';
  else if (type === 'RETUR') logPath = 'history/retur/records';
  else if (type === 'INSPEKSI') logPath = 'history/inspeksi/records';
  else logPath = 'history/keluar/records'; // fallback
  
  const logRef = doc(db, logPath, logId);
  
  try {
    const logSnap = await getDoc(logRef);
    if (!logSnap.exists()) {
      console.warn('Log already deleted or not found');
      return;
    }
    
    const data = logSnap.data();
    let dateStr = String(data.date || '');
    
    // Fallback if date is missing (for legacy records)
    if ((!dateStr || dateStr === 'undefined') && data.createdAt) {
      const d = data.createdAt.toDate ? data.createdAt.toDate() : new Date(data.createdAt);
      dateStr = d.toISOString().split('T')[0];
    }
    
    // Last resort fallback to current date if everything fails
    if (!dateStr || dateStr === 'undefined' || dateStr.length < 10) {
      dateStr = new Date().toISOString().split('T')[0];
    }

    const monthStr = dateStr.substring(0, 7);
    const yearStr = dateStr.substring(0, 4);
    const skuId = data.skuId;
    const warehouseId = data.warehouseId;
    const quantity = data.quantity || 0;

    if (!skuId || !warehouseId) {
      console.warn('Document missing skuId or warehouseId, deleting record only');
      batch.delete(logRef);
      await batch.commit();
      return;
    }

    const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(warehouseId, skuId);
    
    // Determine if it was an outgoing or incoming transaction
    // SCAN and KELUAR are outgoing
    const isOutgoing = (
      type === 'SCAN' || 
      type === 'KELUAR' || 
      data.type === 'SALE' || 
      data.type === 'SPECIAL' || 
      data.type === 'SCAN KELUAR' ||
      data.type === 'KELUAR'
    );
    
    // Reverse logic: 
    // If we delete an OUTGOING (+log), we must ADD back to stock.
    // If we delete an INCOMING (+log), we must SUBTRACT from stock.
    const reversedStockQty = isOutgoing ? quantity : -quantity;
    const reversedMasukQty = isOutgoing ? 0 : -quantity;
    const reversedKeluarQty = isOutgoing ? -quantity : 0;

    const isBrokenStockKeluar = !!data.isBrokenStockKeluar;

    if (skuSnap && skuSnap.exists()) {
      const updateData: any = {
        lastUpdated: serverTimestamp()
      };

      if (type !== 'RETUR' && type !== 'INSPEKSI') {
        // 1. Update SKU stock
        const detailedStock = skuSnap.data().detailedStock || {};
        const sizeKey = String(data.pcsPerCarton || skuSnap.data().pcsPerCarton || 1);
        const usedPcsPerCarton = Number(sizeKey);
        const currentVal = detailedStock[sizeKey];
        
        if (isBrokenStockKeluar) {
          updateData.brokenStock = increment(quantity); // Reverse decrement
          updateData.totalKeluar = increment(reversedKeluarQty);
        } else {
          updateData.currentStock = increment(reversedStockQty);
          updateData.totalMasuk = increment(reversedMasukQty);
          updateData.totalKeluar = increment(reversedKeluarQty);

          // If this was a move to broken stock, subtract from brokenStock
          if (type === 'KELUAR' && data.reason?.toLowerCase().includes('rusak')) {
            updateData.brokenStock = increment(-quantity);
            
            // Delete linked retur log if ID exists
            if (data.autoReturLogId) {
              const linkedReturRef = doc(db, 'history/retur/records', data.autoReturLogId);
              batch.delete(linkedReturRef);
            }
          }

          if (typeof currentVal === 'object' && currentVal !== null) {
            const currentObj = currentVal as { total: number; boxes: number };
            const newTotal = (currentObj.total || 0) + reversedStockQty;
            const newBoxes = Math.floor(Math.max(0, newTotal) / usedPcsPerCarton);

            updateData[`detailedStock.${sizeKey}`] = {
              total: newTotal,
              boxes: newBoxes
            };
          } else {
            // Legacy or simple number
            updateData[`detailedStock.${sizeKey}`] = increment(reversedStockQty);
          }
        }

        // Special handling for return conversion reversal
        if (type === 'MASUK' && (data.isReturnConversion || data.isHoldRelease || data.isBrokenRelease)) {
          if (data.isHoldRelease) {
            updateData.holdStock = increment(quantity);
          } else if (data.isBrokenRelease) {
            updateData.brokenStock = increment(quantity);
          } else {
            updateData.returnStock = increment(quantity);
            
            // Recreate the RETUR record
            const returRef = doc(collection(db, 'history/retur/records'));
            const originalReason = data.reason?.includes(':') 
              ? data.reason.split(':').slice(1).join(':').trim() 
              : data.reason;

            // Merge with existing data but reset metadata and type
            batch.set(returRef, cleanData({
              ...data,
              type: 'RETUR',
              isReturnConversion: undefined,
              isBrokenRelease: undefined,
              reason: originalReason || 'Kembali dari pembatalan inspeksi',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            }));
          }
        }

        // 2. Adjust Summaries - Skip if Broken Stock Keluar
        if (!isBrokenStockKeluar) {
          const skuName = skuSnap.data().name;
          
          batch.set(doc(db, 'history/daily/records', `${dateStr}_${internalSkuId}`), {
            skuId,
            skuName,
            date: dateStr,
            masuk: increment(reversedMasukQty),
            keluar: increment(reversedKeluarQty),
            stokAkhir: increment(reversedStockQty),
            updatedAt: serverTimestamp(),
            warehouseId
          }, { merge: true });

          batch.set(doc(db, 'history/monthly/records', `${monthStr}_${internalSkuId}`), {
            skuId,
            skuName,
            month: monthStr,
            masuk: increment(reversedMasukQty),
            keluar: increment(reversedKeluarQty),
            stok: increment(reversedStockQty),
            updatedAt: serverTimestamp(),
            warehouseId
          }, { merge: true });

          batch.set(doc(db, 'history/yearly/records', `${yearStr}_${internalSkuId}`), {
            skuId,
            skuName,
            year: yearStr,
            masuk: increment(reversedMasukQty),
            keluar: increment(reversedKeluarQty),
            stok: increment(reversedStockQty),
            updatedAt: serverTimestamp(),
            warehouseId
          }, { merge: true });
        }
      } else if (type === 'RETUR') {
        // Reverse returnStock for RETUR
        updateData.returnStock = increment(-quantity);
      } else if (type === 'INSPEKSI') {
        // Revert inspection effects
        updateData.returnStock = increment(quantity);
        if (data.target === 'HOLD') updateData.holdStock = increment(-quantity);
        if (data.target === 'RUSAK') updateData.brokenStock = increment(-quantity);
        if (data.target === 'JUAL') {
          updateData.currentStock = increment(-quantity);
          updateData.totalMasuk = increment(-quantity);
          
          const sizeKey = String(data.pcsPerCarton || skuSnap.data().pcsPerCarton || 1);
          const usedPcsPerCarton = Number(sizeKey);
          const detailedStock = skuSnap.data().detailedStock || {};
          const currentVal = detailedStock[sizeKey];
          
          if (typeof currentVal === 'object' && currentVal !== null) {
            const newTotal = (currentVal.total || 0) - quantity;
            const newBoxes = Math.floor(Math.max(0, newTotal) / usedPcsPerCarton);
            updateData[`detailedStock.${sizeKey}`] = { total: newTotal, boxes: newBoxes };
          } else {
            updateData[`detailedStock.${sizeKey}`] = increment(-quantity);
          }

          // Adjust Summaries for JUAL target reversal
          const skuName = skuSnap.data().name;
          batch.set(doc(db, 'history/daily/records', `${dateStr}_${internalSkuId}`), {
            skuId, skuName, date: dateStr, masuk: increment(-quantity), stokAkhir: increment(-quantity), updatedAt: serverTimestamp(), warehouseId
          }, { merge: true });
          batch.set(doc(db, 'history/monthly/records', `${monthStr}_${internalSkuId}`), {
            skuId, skuName, month: monthStr, masuk: increment(-quantity), stok: increment(-quantity), updatedAt: serverTimestamp(), warehouseId
          }, { merge: true });
          batch.set(doc(db, 'history/yearly/records', `${yearStr}_${internalSkuId}`), {
            skuId, skuName, year: yearStr, masuk: increment(-quantity), stok: increment(-quantity), updatedAt: serverTimestamp(), warehouseId
          }, { merge: true });
        }

        // Recreate the original RETUR record
        const returRef = doc(collection(db, 'history/retur/records'));
        batch.set(returRef, cleanData({
          skuId: data.skuId,
          skuName: skuSnap.data().name,
          quantity: data.quantity,
          warehouseId: data.warehouseId,
          date: dateStr,
          reason: data.reason || 'Batal Inspeksi',
          type: 'RETUR',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }));
      }

      batch.update(skuRef, updateData);
    }

    // 3. Delete the transaction record
    batch.delete(logRef);
    await batch.commit();
    console.log('Transaction successfully reverted and deleted');
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, logPath);
  }
};

export const inspectRetur = async (
  data: {
    skuId: string;
    warehouseId: string;
    quantity: number;
    target: 'JUAL' | 'HOLD' | 'RUSAK';
    condition: 'BAGUS' | 'RUSAK';
    repairable?: boolean;
    pcsPerCarton?: number;
  }
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId);

  if (!skuRef || !skuSnap || !skuSnap.exists()) {
    console.error(`[inspectRetur] SKU MISSING: ${data.skuId} in warehouse ${data.warehouseId}`);
    throw new Error('SKU tidak ditemukan');
  }
  const skuData = skuSnap.data();

  const returRecordsRef = collection(db, 'history/retur/records');

  try {
    // 1. Find and Consume Return Logs
    // We search for both logical and internal SKU IDs to be robust
    const cleanId = data.skuId.trim();
    const logicalId = cleanId.startsWith(data.warehouseId + '_') 
      ? cleanId.substring(data.warehouseId.length + 1) 
      : cleanId;
    const internalId = `${data.warehouseId}_${logicalId}`;

    const queryIds = [...new Set([logicalId, internalId])];

    const q = query(
      returRecordsRef,
      where('warehouseId', '==', data.warehouseId),
      where('skuId', 'in', queryIds)
      // Removed orderBy to avoid index issues, we'll sort in memory
    );

    const logsSnapRaw = await getDocs(q);
    
    if (logsSnapRaw.empty) {
      console.error(`[inspectRetur] NO RETUR LOGS FOUND for SKU: ${data.skuId} (tried ${logicalId}, ${internalId})`);
      throw new Error('Data retur tidak ditemukan untuk SKU ini');
    }

    // Sort in memory instead of Firestore to avoid missing index errors
    const logsDocs = [...logsSnapRaw.docs].sort((a, b) => {
      const tA = a.data().createdAt?.toMillis?.() || 0;
      const tB = b.data().createdAt?.toMillis?.() || 0;
      return tA - tB;
    });

    let remainingToConsume = data.quantity;
    let originalLog: any = {};

    for (const logDoc of logsDocs) {
      if (remainingToConsume <= 0) break;

      const logData = logDoc.data();
      if (Object.keys(originalLog).length === 0) originalLog = logData;

      const logQty = logData.quantity || 0;
      if (logQty <= remainingToConsume) {
        // Consume whole log
        batch.delete(logDoc.ref);
        remainingToConsume -= logQty;
      } else {
        // Partial consume
        batch.update(logDoc.ref, {
          quantity: increment(-remainingToConsume),
          updatedAt: now
        });
        remainingToConsume = 0;
      }
    }

    const updateData: any = {
      lastUpdated: now,
      returnStock: increment(-data.quantity)
    };

    const dateStr = originalLog.date || new Date().toISOString().split('T')[0];
    const monthStr = dateStr.substring(0, 7);
    const yearStr = dateStr.substring(0, 4);

    // 2. Update Target Stock
    if (data.target === 'JUAL') {
      updateData.currentStock = increment(data.quantity);
      updateData.totalMasuk = increment(data.quantity);
      
      const usedSize = data.pcsPerCarton || skuData.pcsPerCarton || 1;
      const sizeKey = String(usedSize);
      const detailedStock = skuData.detailedStock || {};
      const currentVal = detailedStock[sizeKey];
      
      if (typeof currentVal === 'object' && currentVal !== null) {
        const newTotal = (currentVal.total || 0) + data.quantity;
        const newBoxes = Math.floor(newTotal / usedSize);
        updateData[`detailedStock.${sizeKey}`] = { total: newTotal, boxes: newBoxes };
      } else {
        updateData[`detailedStock.${sizeKey}`] = increment(data.quantity);
      }

      // Create MASUK record for Main Menu Database (History)
      const masukRef = doc(collection(db, 'history/masuk/records'));
      batch.set(masukRef, cleanData({
        ...originalLog,
        quantity: data.quantity,
        type: 'MASUK',
        isReturnConversion: true,
        reason: `Konversi Retur (${data.condition})${data.repairable ? ' - Hasil Perbaikan' : ''}: ${originalLog.reason || ''}`,
        createdAt: now,
        updatedAt: now,
        inputMode: data.pcsPerCarton ? 'CARTON' : 'PCS',
        pcsPerCarton: usedSize
      }));

      // Update Summaries
      batch.set(doc(db, 'history/daily/records', `${dateStr}_${internalSkuId}`), {
        skuId: data.skuId,
        skuName: skuData.name,
        date: dateStr,
        masuk: increment(data.quantity),
        stokAkhir: increment(data.quantity),
        updatedAt: now,
        warehouseId: data.warehouseId
      }, { merge: true });

      batch.set(doc(db, 'history/monthly/records', `${monthStr}_${internalSkuId}`), {
        skuId: data.skuId,
        skuName: skuData.name,
        month: monthStr,
        masuk: increment(data.quantity),
        stok: increment(data.quantity),
        updatedAt: now,
        warehouseId: data.warehouseId
      }, { merge: true });

      batch.set(doc(db, 'history/yearly/records', `${yearStr}_${internalSkuId}`), {
        skuId: data.skuId,
        skuName: skuData.name,
        year: yearStr,
        masuk: increment(data.quantity),
        stok: increment(data.quantity),
        updatedAt: now,
        warehouseId: data.warehouseId
      }, { merge: true });

    } else if (data.target === 'HOLD') {
      updateData.holdStock = increment(data.quantity);
    } else if (data.target === 'RUSAK') {
      updateData.brokenStock = increment(data.quantity);
    }

    batch.update(skuRef, updateData);

    // 3. Create Inspection Log
    const inspectionLogRef = doc(collection(db, 'history/inspeksi/records'));
    const logData = cleanData({
      ...data,
      type: 'INSPEKSI',
      createdAt: now,
      updatedAt: now
    });
    batch.set(inspectionLogRef, logData);

    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'history/inspeksi');
  }
};

export const releaseFromHold = async (
  data: {
    skuId: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
  }
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId);

  if (!skuRef || !skuSnap || !skuSnap.exists()) {
    console.error(`[releaseFromHold] SKU MISSING: ${data.skuId} in warehouse ${data.warehouseId}`);
    throw new Error('SKU tidak ditemukan');
  }
  const skuData = skuSnap.data();

  try {
    if ((skuData.holdStock || 0) < data.quantity) {
      throw new Error('Stok Hold tidak mencukupi');
    }

    const updateData: any = {
      lastUpdated: now,
      holdStock: increment(-data.quantity),
      currentStock: increment(data.quantity),
      totalMasuk: increment(data.quantity)
    };

    const usedSize = skuData.pcsPerCarton || 1;
    const sizeKey = String(usedSize);
    const detailedStock = skuData.detailedStock || {};
    const currentVal = detailedStock[sizeKey];
    
    if (typeof currentVal === 'object' && currentVal !== null) {
      const newTotal = (currentVal.total || 0) + data.quantity;
      const newBoxes = Math.floor(newTotal / usedSize);
      updateData[`detailedStock.${sizeKey}`] = { total: newTotal, boxes: newBoxes };
    } else {
      updateData[`detailedStock.${sizeKey}`] = increment(data.quantity);
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const monthStr = dateStr.substring(0, 7);
    const yearStr = dateStr.substring(0, 4);

    // Create MASUK record
    const masukRef = doc(collection(db, 'history/masuk/records'));
    batch.set(masukRef, cleanData({
      skuId: data.skuId,
      skuName: skuData.name,
      quantity: data.quantity,
      warehouseId: data.warehouseId,
      date: dateStr,
      type: 'MASUK',
      isHoldRelease: true,
      reason: data.reason || 'Pelepasan dari HOLD',
      createdAt: now,
      updatedAt: now,
      pcsPerCarton: usedSize
    }));

    // Update Summaries
    batch.set(doc(db, 'history/daily/records', `${dateStr}_${internalSkuId}`), {
      skuId: data.skuId, skuName: skuData.name, date: dateStr, masuk: increment(data.quantity), stokAkhir: increment(data.quantity), updatedAt: now, warehouseId: data.warehouseId
    }, { merge: true });

    batch.set(doc(db, 'history/monthly/records', `${monthStr}_${internalSkuId}`), {
      skuId: data.skuId, skuName: skuData.name, month: monthStr, masuk: increment(data.quantity), stok: increment(data.quantity), updatedAt: now, warehouseId: data.warehouseId
    }, { merge: true });

    batch.set(doc(db, 'history/yearly/records', `${yearStr}_${internalSkuId}`), {
      skuId: data.skuId, skuName: skuData.name, year: yearStr, masuk: increment(data.quantity), stok: increment(data.quantity), updatedAt: now, warehouseId: data.warehouseId
    }, { merge: true });

    batch.update(skuRef, updateData);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'history/hold/release');
  }
};

export const disposeBrokenStock = async (
  data: {
    skuId: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
  }
) => {
  // Disposing broken stock is logically an OUTGOING transaction with reason 'rusak'
  // But we make it a dedicated helper for the UI
  return processTransaction('KELUAR', {
    skuId: data.skuId,
    warehouseId: data.warehouseId,
    quantity: data.quantity,
    reason: data.reason || 'Pemusnahan Barang Rusak',
    date: new Date().toISOString().split('T')[0],
    isBrokenStockKeluar: true
  });
};

export const releaseFromBroken = async (
  data: {
    skuId: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
  }
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId);

  if (!skuRef || !skuSnap || !skuSnap.exists()) {
    console.error(`[releaseFromBroken] SKU MISSING: ${data.skuId} in warehouse ${data.warehouseId}`);
    throw new Error('SKU tidak ditemukan');
  }
  const skuData = skuSnap.data();

  try {
    if ((skuData.brokenStock || 0) < data.quantity) {
      throw new Error('Stok Rusak tidak mencukupi');
    }

    const updateData: any = {
      lastUpdated: now,
      brokenStock: increment(-data.quantity),
      currentStock: increment(data.quantity),
      totalMasuk: increment(data.quantity)
    };

    const usedSize = skuData.pcsPerCarton || 1;
    const sizeKey = String(usedSize);
    const detailedStock = skuData.detailedStock || {};
    const currentVal = detailedStock[sizeKey];
    
    if (typeof currentVal === 'object' && currentVal !== null) {
      const newTotal = (currentVal.total || 0) + data.quantity;
      const newBoxes = Math.floor(newTotal / usedSize);
      updateData[`detailedStock.${sizeKey}`] = { total: newTotal, boxes: newBoxes };
    } else {
      updateData[`detailedStock.${sizeKey}`] = increment(data.quantity);
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const monthStr = dateStr.substring(0, 7);
    const yearStr = dateStr.substring(0, 4);

    // Create MASUK record
    const masukRef = doc(collection(db, 'history/masuk/records'));
    batch.set(masukRef, cleanData({
      skuId: data.skuId,
      skuName: skuData.name,
      quantity: data.quantity,
      warehouseId: data.warehouseId,
      date: dateStr,
      type: 'MASUK',
      isBrokenRelease: true,
      reason: `Rilis dari Stok Rusak: ${data.reason || ''}`,
      createdAt: now,
      updatedAt: now,
      inputMode: 'PCS',
      pcsPerCarton: usedSize
    }));

    // Update Summaries
    batch.set(doc(db, 'history/daily/records', `${dateStr}_${internalSkuId}`), {
      skuId: data.skuId, skuName: skuData.name, date: dateStr, masuk: increment(data.quantity), stokAkhir: increment(data.quantity), updatedAt: now, warehouseId: data.warehouseId
    }, { merge: true });

    batch.set(doc(db, 'history/monthly/records', `${monthStr}_${internalSkuId}`), {
      skuId: data.skuId, skuName: skuData.name, month: monthStr, masuk: increment(data.quantity), stok: increment(data.quantity), updatedAt: now, warehouseId: data.warehouseId
    }, { merge: true });

    batch.set(doc(db, 'history/yearly/records', `${yearStr}_${internalSkuId}`), {
      skuId: data.skuId, skuName: skuData.name, year: yearStr, masuk: increment(data.quantity), stok: increment(data.quantity), updatedAt: now, warehouseId: data.warehouseId
    }, { merge: true });

    batch.update(skuRef, updateData);
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, 'history/broken/release');
  }
};

export const importReturLogs = async (
  warehouseId: string,
  records: {
    skuId: string;
    quantity: number;
    receiptId: string;
    date: string;
    reason?: string;
  }[]
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  for (const rec of records) {
    const { ref: skuRef, snap: skuSnap } = await findSku(warehouseId, rec.skuId);
    if (!skuRef || !skuSnap.exists()) continue;

    const skuData = skuSnap.data();
    const logRef = doc(collection(db, 'history/retur/records'));
    
    batch.set(logRef, cleanData({
      ...rec,
      skuName: skuData.name,
      warehouseId,
      type: 'RETUR',
      createdAt: now,
      updatedAt: now,
      inputMode: 'PCS'
    }));

    // Update returnStock on SKU
    batch.update(skuRef, {
      returnStock: increment(rec.quantity),
      lastUpdated: now
    });
  }

  await batch.commit();
};

export const bulkUpdateSpecialStock = async (
  warehouseId: string,
  type: 'HOLD' | 'RUSAK',
  records: {
    skuId: string;
    quantity: number; // The NEW total quantity
  }[]
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  for (const rec of records) {
    const { ref: skuRef, snap: skuSnap } = await findSku(warehouseId, rec.skuId);
    if (!skuRef || !skuSnap.exists()) continue;

    const field = type === 'HOLD' ? 'holdStock' : 'brokenStock';
    batch.update(skuRef, {
      [field]: rec.quantity,
      lastUpdated: now
    });
  }

  await batch.commit();
};
