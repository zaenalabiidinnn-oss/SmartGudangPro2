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
const findSku = async (warehouseId: string, skuId: string, name?: string) => {
  const cleanId = skuId.trim();
  const cleanName = name?.trim();

  // 1. If name is provided, try searching for the exact combo first
  // This is the primary way to distinguish SKUs with same ID but different names
  if (cleanName) {
    const q = query(
      collection(db, 'skus'),
      where('warehouseId', '==', warehouseId),
      where('id', '==', cleanId),
      where('name', '==', cleanName),
      limit(1)
    );
    const snap = await getDocs(q);
    if (!snap.empty) {
      return { ref: snap.docs[0].ref, snap: snap.docs[0], internalId: snap.docs[0].id };
    }
    
    // If name is provided but NOT found, we DO NOT fall back to "ID only" search locally
    // because that would lead to mixing different products with the same SKU ID.
    // However, we still do the global search as a hint for metadata/consistency
  } else {
    // 2. No name provided: Try prefixed ID (Legacy standard format)
    const logicalId = cleanId.startsWith(warehouseId + '_') 
      ? cleanId.substring(warehouseId.length + 1) 
      : cleanId;
    const internalId = `${warehouseId}_${logicalId}`;
    
    const ref1 = doc(db, 'skus', internalId);
    const snap1 = await getDoc(ref1);
    if (snap1.exists()) {
      return { ref: ref1, snap: snap1, internalId };
    }

    // 3. Try to find any SKU with this ID in this warehouse (handles slugged IDs)
    const qIdOnly = query(
      collection(db, 'skus'),
      where('warehouseId', '==', warehouseId),
      where('id', '==', logicalId),
      limit(1)
    );
    const snapIdOnly = await getDocs(qIdOnly);
    if (!snapIdOnly.empty) {
      return { ref: snapIdOnly.docs[0].ref, snap: snapIdOnly.docs[0], internalId: snapIdOnly.docs[0].id };
    }

    // 4. Try raw ID (Legacy or direct format)
    const ref2 = doc(db, 'skus', cleanId);
    const snap2 = await getDoc(ref2);
    if (snap2.exists()) {
      const data = snap2.data();
      if (data.warehouseId === warehouseId) {
        return { ref: ref2, snap: snap2, internalId: cleanId };
      }
    }
  }

  // 5. Global search as fallback/hint (across all warehouses)
  const logicalIdForGlobal = cleanId.startsWith(warehouseId + '_') 
    ? cleanId.substring(warehouseId.length + 1) 
    : cleanId;
    
  const globalQ = cleanName 
    ? query(collection(db, 'skus'), where('id', '==', logicalIdForGlobal), where('name', '==', cleanName), limit(1))
    : query(collection(db, 'skus'), where('id', '==', logicalIdForGlobal), limit(1));
    
  const globalSnap = await getDocs(globalQ);
  if (!globalSnap.empty) {
    const globalDoc = globalSnap.docs[0];
    return { ref: null, snap: globalDoc, internalId: `${warehouseId}_${logicalIdForGlobal}`, isGlobalMatch: true };
  }

  return { ref: null, snap: null, internalId: null };
};

export const processTransaction = async (
  type: TransactionType,
  data: {
    skuId: string;
    skuName?: string;
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
    let { ref: skuRef, snap: skuSnap, internalId: internalSkuId, isGlobalMatch } = await findSku(data.warehouseId, data.skuId, data.skuName);
    
    // Auto-create SKU placeholder if it's an inbound transaction and it exists elsewhere
    // Or even if it's new, we allow creating it if it's a RETUR/MASUK
    const isInbound = type === 'MASUK' || type === 'RETUR';
    
    if (!skuRef || !skuSnap || !skuSnap.exists()) {
      if (isInbound) {
        // If it's inbound but missing everywhere, we create a placeholder
        const logicalId = data.skuId.trim().startsWith(data.warehouseId + '_') 
          ? data.skuId.trim().substring(data.warehouseId.length + 1) 
          : data.skuId.trim();
        
        // Use name from global match if available, otherwise use provided name or ID
        const nameToUse = data.skuName || (isGlobalMatch && skuSnap ? skuSnap.data().name : logicalId);
        
        // Generate a unique internal ID that accounts for name if it's a "new" duplicate SKU ID
        // We use a slug of the name to keep the ID readable but distinct
        const nameSlug = nameToUse.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
        const newInternalId = `${data.warehouseId}_${logicalId}_${nameSlug}`;
        
        skuRef = doc(db, 'skus', newInternalId);
        internalSkuId = newInternalId;
        
        const thresholdToUse = isGlobalMatch && skuSnap ? (skuSnap.data().threshold || 10) : 10;
        const pcsPerCartonToUse = data.pcsPerCarton || (isGlobalMatch && skuSnap ? (skuSnap.data().pcsPerCarton || 1) : 1);

        batch.set(skuRef, {
          id: logicalId,
          name: nameToUse,
          currentStock: 0,
          threshold: thresholdToUse,
          pcsPerCarton: pcsPerCartonToUse,
          detailedStock: { [String(pcsPerCartonToUse)]: { total: 0, boxes: 0 } },
          createdAt: now,
          lastUpdated: now,
          warehouseId: data.warehouseId
        });
        
        // Mock a snapshot for the rest of the function
        skuSnap = { 
          exists: () => true, 
          data: () => ({ 
            name: nameToUse, 
            currentStock: 0, 
            detailedStock: {},
            pcsPerCarton: pcsPerCartonToUse
          }) 
        } as any;
      } else {
        console.error(`[processTransaction] SKU MISSING: ${data.skuId} in warehouse ${data.warehouseId}`);
        throw new Error('SKU tidak ditemukan di gudang ini');
      }
    }

    const skuData = skuSnap.data();
    const skuName = skuData.name;

    // Determine internal type for log
    let logType = type as string;
    if (type === 'SCAN') logType = 'SCAN KELUAR';
    if (type === 'MASUK') logType = 'MASUK';
    if (type === 'KELUAR') logType = 'KELUAR';
    if (type === 'RETUR') logType = 'RETUR';

    // 2. Determine which packaging size to use for breakdown
    const isOutgoing = type === 'SCAN' || type === 'KELUAR';
    const isRetur = type === 'RETUR';
    const totalQuantity = data.quantity;
    
    const detailedStock = skuSnap.data()?.detailedStock || {};
    const skuPcsPerCarton = skuSnap.data()?.pcsPerCarton ?? 1;

    let updateData: any = {
      lastUpdated: now
    };

    const logs: any[] = [];

    if (isOutgoing) {
      // Determine packaging size
      const usedPcsPerCarton = (data.pcsPerCarton && data.pcsPerCarton > 1) ? data.pcsPerCarton : (skuPcsPerCarton || 1);
      const sizeKey = String(usedPcsPerCarton);

      if (data.isBrokenStockKeluar) {
        // DISPOSING BROKEN STOCK: Decrement broken stock pool
        updateData.brokenStock = increment(-totalQuantity);
        // We still log it as a KELUAR transaction for history purposes
      } else {
        // NORMAL OUTGOING LOGIC (from currentStock)
        updateData.currentStock = increment(-totalQuantity);
        updateData.totalKeluar = increment(totalQuantity);

        // If reason contains 'rusak', move to broken stock pool and add to retur history for visibility
        const reasonLower = (data.reason || '').toLowerCase();
        if (reasonLower.includes('rusak')) {
          updateData.brokenStock = increment(totalQuantity);
          
          // Add a shadow record to retur logs so it appears in the Retur management sub-menu
          const returLogRef = doc(collection(db, 'history/retur/records'));
          batch.set(returLogRef, cleanData({
            ...data,
            quantity: totalQuantity,
            skuName,
            type: 'RETUR',
            isAutoProcessed: true, // Flag to identify it was moved from Keluar
            reason: `[AUTO-BROKEN] ${data.reason}`,
            createdAt: now,
            updatedAt: now,
            warehouseId: data.warehouseId
          }));
        }
        
        // Update the specific size group
        updateData[`detailedStock.${sizeKey}.total`] = increment(-totalQuantity);
        
        // Calculate resulting boxes for this size group
        const currentSizeTotal = detailedStock[sizeKey]?.total || 0;
        const newSizeTotal = currentSizeTotal - totalQuantity;
        updateData[`detailedStock.${sizeKey}.boxes`] = usedPcsPerCarton > 1 ? Math.floor(newSizeTotal / usedPcsPerCarton) : 0;
      }

      logs.push({
        ...data,
        quantity: totalQuantity,
        pcsPerCarton: data.pcsPerCarton ?? skuPcsPerCarton, // Keep original for log record
        inputMode: (data.pcsPerCarton && data.pcsPerCarton > 1) ? 'CARTON' : 'PCS',
        skuName,
        type: logType,
        createdAt: now,
        updatedAt: now,
        warehouseId: data.warehouseId
      });
    } else {
      // HANDLE ALL INCOMING-STYLE LOGS (MASUK, RETUR, RESTOCK, KOREKSI)
      const isInbound = logType === 'MASUK' || logType === 'RETUR' || logType === 'RESTOCK' || logType === 'KOREKSI';
      
      if (isInbound) {
        const usedPcsPerCarton = data.pcsPerCarton ?? skuPcsPerCarton;
        const sizeKey = String(usedPcsPerCarton);
        const divisor = usedPcsPerCarton || 1;
        
        if (logType === 'KOREKSI') {
          updateData.currentStock = totalQuantity;
          updateData[`detailedStock.${sizeKey}.total`] = totalQuantity;
          updateData[`detailedStock.${sizeKey}.boxes`] = usedPcsPerCarton > 0 ? Math.floor(totalQuantity / usedPcsPerCarton) : 0;
        } else if (logType === 'RETUR') {
          // RETUR: Only affects returnStock and its own log. 
          // It does NOT affect currentStock until inspected.
          updateData.returnStock = increment(totalQuantity);
        } else {
          // MASUK and RESTOCK
          updateData.currentStock = increment(totalQuantity);
          updateData[`detailedStock.${sizeKey}.total`] = increment(totalQuantity);
          
          // Use absolute calculation from the new total for boxes to keep them in sync
          const currentTotal = detailedStock[sizeKey]?.total || 0;
          const newTotal = currentTotal + totalQuantity;
          updateData[`detailedStock.${sizeKey}.boxes`] = usedPcsPerCarton > 0 ? Math.floor(newTotal / usedPcsPerCarton) : 0;
        }

        if (logType === 'MASUK' || logType === 'RESTOCK') {
          updateData.totalMasuk = increment(totalQuantity);
        }

        logs.push({
          ...data,
          inputMode: (data.pcsPerCarton && data.pcsPerCarton > 1) ? 'CARTON' : 'PCS',
          pcsPerCarton: usedPcsPerCarton,
          skuName,
          type: logType,
          createdAt: now,
          updatedAt: now,
          warehouseId: data.warehouseId
        });
      }
    }

    // Write all logs (one or more)
    for (const logData of logs) {
      if (logData.quantity !== 0) {
        let coll = 'history/keluar/records';
        if (logData.type === 'MASUK' || logData.type === 'RESTOCK') coll = 'history/masuk/records';
        else if (logData.type === 'RETUR') coll = 'history/retur/records';
        else if (logData.type === 'KOREKSI') coll = 'history/koreksi/records';

        const newLogRef = doc(collection(db, coll));
        batch.set(newLogRef, cleanData(logData));
      }
    }

    // 3. Update SKU stock (only if not empty except lastUpdated)
    if (Object.keys(updateData).length > 1) {
      batch.update(skuRef, updateData);
    }

    // 4. Update Summaries (Harian, Bulanan, Tahunan) - Skip if RETUR
    if (type !== 'RETUR') {
      const dateStr = data.date; // YYYY-MM-DD
      // If its disposing broken stock, current stock doesn't change, so qtyChange for summaries should be 0
      const qtyChange = data.isBrokenStockKeluar ? 0 : (isOutgoing ? -totalQuantity : totalQuantity);
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

    if (skuSnap && skuSnap.exists()) {
      const updateData: any = {
        lastUpdated: serverTimestamp()
      };

      // REWRITE: Restructured deleteTransaction to avoid double counting and unreachable blocks
      if (type === 'INSPEKSI' || data.type === 'INSPEKSI') {
        const { target, quantity, skuId: logSkuId, warehouseId: logWHId, targetStock } = data;
        const effectiveTarget = target || targetStock; // Handle legacy field names

        console.log(`Reversing inspection to target: ${effectiveTarget}`);

        // 1. Revert from target pool
        if (effectiveTarget === 'HOLD') {
          updateData.holdStock = increment(-quantity);
        } else if (effectiveTarget === 'RUSAK') {
          updateData.brokenStock = increment(-quantity);
        } else if (effectiveTarget === 'JUAL') {
          updateData.currentStock = increment(-quantity);
          updateData.totalMasuk = increment(-quantity);
          
          const rawSize = data.pcsPerCarton ?? skuSnap.data().pcsPerCarton;
          const sizeKey = String(rawSize || 1);
          const usedPcsPerCarton = Number(rawSize || 1);
          const detailedStock = skuSnap.data().detailedStock || {};
          const currentVal = detailedStock[sizeKey];
          
          if (typeof currentVal === 'object' && currentVal !== null) {
            const newTotal = (currentVal.total || 0) - quantity;
            const newBoxes = usedPcsPerCarton > 0 ? Math.floor(Math.max(0, newTotal) / usedPcsPerCarton) : 0;
            updateData[`detailedStock.${sizeKey}`] = { total: newTotal, boxes: newBoxes };
          } else {
            updateData[`detailedStock.${sizeKey}`] = increment(-quantity);
          }

          // Adjust Summaries for JUAL target reversal (only JUAL affects summaries)
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
          
          // Also find and delete the shadow MASUK record created during inspection
          const masukQ = query(
            collection(db, 'history/masuk/records'),
            where('warehouseId', '==', warehouseId),
            where('skuId', '==', skuId),
            where('isReturnConversion', '==', true),
            where('createdAt', '>=', new Date(Date.now() - 60000)) // Recent lookup context
          );
          const masukSnap = await getDocs(masukQ);
          masukSnap.forEach(doc => {
            const mData = doc.data();
            // Match quantity and source context to be safe
            if (Math.abs(mData.quantity) === Math.abs(quantity)) {
               batch.delete(doc.ref);
            }
          });
        }

        // 2. Return back to returnStock
        updateData.returnStock = increment(quantity);

        // 3. Recreate the original RETUR record if possible
        const returRef = doc(collection(db, 'history/retur/records'));
        batch.set(returRef, cleanData({
          skuId: data.skuId,
          skuName: skuSnap.data().name,
          quantity: data.quantity,
          warehouseId: data.warehouseId,
          date: dateStr,
          reason: data.reason || 'Batal Inspeksi / Reversal',
          type: 'RETUR',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }));

      } else if (type === 'RETUR' || data.type === 'RETUR') {
        // RETUR: Only affects returnStock (and brokenStock if it was an auto-processed one)
        if (data.isAutoProcessed) {
           // If it came from a KELUAR (Rusak) item
           updateData.brokenStock = increment(-quantity);
           // Note: The original KELUAR that caused this usually stays. 
           // Deleting the shadow RETUR just removes it from the inspection list and broken pool.
        } else {
           updateData.returnStock = increment(-quantity);
        }
        // RETUR does not affect currentStock or summaries in our updated logic
      } else if (data.type === 'KOREKSI') {
        // Handle KOREKSI specially if needed (usually just delete log and let user manually re-koreksi)
        // For now, KOREKSI doesn't automatically reverse because it represents absolute state
        console.log('Deleting KOREKSI log only');
      } else {
        // Standard Transactions (MASUK, KELUAR, SCAN, SALE, etc.)
        const isOutgoing = (
          type === 'SCAN' || 
          type === 'KELUAR' || 
          data.type === 'SALE' || 
          data.type === 'SPECIAL' || 
          data.type === 'SCAN KELUAR' ||
          data.type === 'KELUAR'
        );
        
        const reversedStockQty = isOutgoing ? quantity : -quantity;
        const reversedMasukQty = isOutgoing ? 0 : -quantity;
        const reversedKeluarQty = isOutgoing ? -quantity : 0;

        if (data.isBrokenStockKeluar) {
            updateData.brokenStock = increment(quantity);
        } else {
            updateData.currentStock = increment(reversedStockQty);
            if (isOutgoing) {
                updateData.totalKeluar = increment(-quantity);
                const reasonLower = (data.reason || '').toLowerCase();
                if (reasonLower.includes('rusak')) {
                    updateData.brokenStock = increment(-quantity);
                    const shadowQ = query(
                        collection(db, 'history/retur/records'),
                        where('warehouseId', '==', warehouseId),
                        where('skuId', '==', skuId),
                        where('receiptId', '==', data.receiptId),
                        where('isAutoProcessed', '==', true)
                    );
                    const shadowSnap = await getDocs(shadowQ);
                    shadowSnap.forEach(doc => batch.delete(doc.ref));
                }
            } else {
              updateData.totalMasuk = increment(-quantity);
            }

            const sizeKey = String(data.pcsPerCarton ?? skuSnap.data().pcsPerCarton ?? 1);
            const divisor = Number(sizeKey);
            updateData[`detailedStock.${sizeKey}.total`] = increment(reversedStockQty);
            
            const fullCartons = divisor > 1 ? Math.floor(quantity / divisor) : 0;
            if (fullCartons !== 0) {
              updateData[`detailedStock.${sizeKey}.boxes`] = increment(isOutgoing ? fullCartons : -fullCartons);
            }
        }

        // Adjust Summaries
        const skuName = skuSnap.data().name;
        const summaryStockChange = data.isBrokenStockKeluar ? 0 : reversedStockQty;
        
        batch.set(doc(db, 'history/daily/records', `${dateStr}_${internalSkuId}`), {
          skuId, skuName, date: dateStr, masuk: increment(reversedMasukQty), keluar: increment(reversedKeluarQty), stokAkhir: increment(summaryStockChange), updatedAt: serverTimestamp(), warehouseId
        }, { merge: true });

        batch.set(doc(db, 'history/monthly/records', `${monthStr}_${internalSkuId}`), {
          skuId, skuName, month: monthStr, masuk: increment(reversedMasukQty), keluar: increment(reversedKeluarQty), stok: increment(summaryStockChange), updatedAt: serverTimestamp(), warehouseId
        }, { merge: true });

        batch.set(doc(db, 'history/yearly/records', `${yearStr}_${internalSkuId}`), {
          skuId, skuName, year: yearStr, masuk: increment(reversedMasukQty), keluar: increment(reversedKeluarQty), stok: increment(summaryStockChange), updatedAt: serverTimestamp(), warehouseId
        }, { merge: true });
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
    skuName?: string;
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
  
  const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId, data.skuName);

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
      
      const rawSize = data.pcsPerCarton ?? skuData.pcsPerCarton;
      const sizeKey = String(rawSize ?? 1);
      const divisor = rawSize || 1;
      const detailedStock = skuData.detailedStock || {};
      const currentVal = detailedStock[sizeKey];
      
      if (typeof currentVal === 'object' && currentVal !== null) {
        const newTotal = (currentVal.total || 0) + data.quantity;
        const newBoxes = rawSize === 0 ? 0 : Math.floor(newTotal / divisor);
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
        pcsPerCarton: divisor
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
    skuName?: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
    pcsPerCarton?: number;
  }
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId, data.skuName);

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

    const rawSize = data.pcsPerCarton ?? skuData.pcsPerCarton;
    const sizeKey = String(rawSize ?? 1);
    const divisor = rawSize || 1;
    const detailedStock = skuData.detailedStock || {};
    const currentVal = detailedStock[sizeKey];
    
    if (typeof currentVal === 'object' && currentVal !== null) {
      const newTotal = (currentVal.total || 0) + data.quantity;
      const newBoxes = rawSize === 0 ? 0 : Math.floor(newTotal / divisor);
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
      pcsPerCarton: divisor
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
    skuName?: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
  }
) => {
  // Disposing broken stock is logically an OUTGOING transaction with reason 'rusak'
  // But we make it a dedicated helper for the UI
  return processTransaction('KELUAR', {
    skuId: data.skuId,
    skuName: data.skuName,
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
    skuName?: string;
    warehouseId: string;
    quantity: number;
    reason?: string;
    pcsPerCarton?: number;
  }
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  const { ref: skuRef, snap: skuSnap, internalId: internalSkuId } = await findSku(data.warehouseId, data.skuId, data.skuName);

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

    const rawSize = data.pcsPerCarton ?? skuData.pcsPerCarton;
    const sizeKey = String(rawSize ?? 1);
    const divisor = rawSize || 1;
    const detailedStock = skuData.detailedStock || {};
    const currentVal = detailedStock[sizeKey];
    
    if (typeof currentVal === 'object' && currentVal !== null) {
      const newTotal = (currentVal.total || 0) + data.quantity;
      const newBoxes = rawSize === 0 ? 0 : Math.floor(newTotal / divisor);
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
      pcsPerCarton: divisor
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
    skuName?: string; // Optional provided name from Excel
    quantity: number;
    receiptId: string;
    date: string;
    reason?: string;
  }[]
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  for (const rec of records) {
    let { ref: skuRef, snap: skuSnap, isGlobalMatch } = await findSku(warehouseId, rec.skuId, rec.skuName);
    
    // Auto-create SKU if it doesn't exist yet
    if (!skuRef || !skuSnap || !skuSnap.exists()) {
      const logicalId = rec.skuId.trim();
      
      const nameToUse = rec.skuName || (isGlobalMatch && skuSnap ? skuSnap.data().name : logicalId);
      const nameSlug = nameToUse.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
      const newInternalId = `${warehouseId}_${logicalId}_${nameSlug}`;

      skuRef = doc(db, 'skus', newInternalId);
      
      batch.set(skuRef, {
        id: logicalId,
        name: nameToUse,
        currentStock: 0,
        threshold: 10,
        pcsPerCarton: 1,
        detailedStock: { "1": { total: 0, boxes: 0 } },
        createdAt: now,
        lastUpdated: now,
        warehouseId
      });
      
      // Update local snap for logical consistency in remainder of loop
      skuSnap = { 
        exists: () => true, 
        data: () => ({ name: nameToUse }) 
      } as any;
    }

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
    skuName?: string;
    quantity: number; // The NEW total quantity
  }[]
) => {
  const batch = writeBatch(db);
  const now = serverTimestamp();
  
  for (const rec of records) {
    let { ref: skuRef, snap: skuSnap, isGlobalMatch } = await findSku(warehouseId, rec.skuId, rec.skuName);
    
    // Auto-create SKU if it doesn't exist yet
    if (!skuRef || !skuSnap || !skuSnap.exists()) {
      const logicalId = rec.skuId.trim();
      
      const nameToUse = rec.skuName || (isGlobalMatch && skuSnap ? skuSnap.data().name : logicalId);
      const nameSlug = nameToUse.toLowerCase().replace(/[^a-z0-9]/g, '-').substring(0, 20);
      const newInternalId = `${warehouseId}_${logicalId}_${nameSlug}`;

      skuRef = doc(db, 'skus', newInternalId);
      
      batch.set(skuRef, {
        id: logicalId,
        name: nameToUse,
        currentStock: 0,
        threshold: 10,
        pcsPerCarton: 1,
        detailedStock: { "1": { total: 0, boxes: 0 } },
        createdAt: now,
        lastUpdated: now,
        warehouseId
      });
    }

    const field = type === 'HOLD' ? 'holdStock' : 'brokenStock';
    batch.update(skuRef, {
      [field]: rec.quantity,
      lastUpdated: now
    });
  }

  await batch.commit();
};
