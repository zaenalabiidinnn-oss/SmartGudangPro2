import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, orderBy, limit, getDocs, where, setDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { processTransaction, deleteTransaction } from '../services/rekapService';
import { SKU } from '../types';
import { Trash2, Scan, AlertCircle, Filter, X, FileDown, Upload, FileQuestion, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { utils, read, writeFile } from 'xlsx';

const DataScan: React.FC = () => {
  const { activeWarehouse } = useWarehouse();
  const [skus, setSkus] = useState<SKU[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    date: '',
    skuId: '',
    receiptId: '',
  });

  // Unique values for filters
  const uniqueItems = Array.from(new Set(logs.map(l => l.skuId))).filter(Boolean).sort();

  const filteredLogs = logs.filter(log => {
    const logDate = log.date || '';

    const matchesDate = !filters.date || logDate === filters.date;
    const matchesSku = !filters.skuId || log.skuId === filters.skuId;
    const matchesRef = !filters.receiptId || log.receiptId?.toLowerCase().includes(filters.receiptId.toLowerCase());

    return matchesDate && matchesSku && matchesRef;
  });

  const receiptCounts = filteredLogs.reduce((acc, log) => {
    acc[log.receiptId] = (acc[log.receiptId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const inputRef = useRef<HTMLInputElement>(null);

  // Grouping logic constants
  const GROUP_COLORS = [
    'bg-emerald-500', 'bg-amber-500', 'bg-rose-500', 
    'bg-cyan-500', 'bg-fuchsia-500', 'bg-violet-500',
    'bg-orange-500', 'bg-lime-500', 'bg-blue-500', 'bg-teal-500'
  ];

  const getGroupColor = (rid: string) => {
    if (!rid) return GROUP_COLORS[0];
    let hash = 0;
    for (let i = 0; i < rid.length; i++) {
      hash = rid.charCodeAt(i) + ((hash << 5) - hash);
    }
    return GROUP_COLORS[Math.abs(hash) % GROUP_COLORS.length];
  };

  useEffect(() => {
    if (!activeWarehouse) return;

    const unsubSkus = onSnapshot(query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id)), (snap) => {
      setSkus(snap.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id.split('_').slice(1).join('_') } as SKU;
      }));
    }, (error) => {
      console.error("Error fetching skus in DataScan:", error);
      handleFirestoreError(error, OperationType.LIST, 'skus');
    });

    const q = query(
      collection(db, 'history/keluar/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsubLogs = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(log => log.type === 'SCAN KELUAR'));
    }, (error) => {
      console.error("Error fetching logs in DataScan:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/keluar/records');
    });

    return () => {
      unsubSkus();
      unsubLogs();
    };
  }, [activeWarehouse]);

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setIsDeleting(id);
    try {
      await deleteTransaction('SCAN', id);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Gagal menghapus scan.';
      setError(msg);
      window.alert(`Peringatan: ${msg}`);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!selectedSku) {
      const msg = 'Pilih SKU terlebih dahulu!';
      setError(msg);
      window.alert(msg);
      return;
    }
    if (!receiptId) {
      const msg = 'Masukkan nomor resi!';
      setError(msg);
      window.alert(msg);
      return;
    }

    if (!activeWarehouse) {
      const msg = 'Pilih gudang terlebih dahulu!';
      setError(msg);
      window.alert(msg);
      return;
    }

    setIsProcessing(true);
    try {
      // Check for duplicates (same SKU + same Receipt ID + same Warehouse)
      const qCheck = query(
        collection(db, 'history/keluar/records'),
        where('skuId', '==', selectedSku),
        where('receiptId', '==', receiptId),
        where('warehouseId', '==', activeWarehouse.id)
      );
      const checkSnap = await getDocs(qCheck);
      
      if (!checkSnap.empty) {
        const msg = `ITEM DUPLIKAT: SKU ${selectedSku} dengan Resi ${receiptId} sudah pernah di-scan!`;
        setError(msg);
        window.alert(msg);
        setIsProcessing(false);
        return;
      }

      await processTransaction('SCAN', {
        skuId: selectedSku,
        quantity,
        receiptId,
        date: new Date().toISOString().split('T')[0],
        warehouseId: activeWarehouse.id
      });
      setReceiptId('');
      setQuantity(1);
      inputRef.current?.focus();
    } catch (err) {
      const msg = 'Gagal memproses scan. ' + (err instanceof Error ? err.message : '');
      setError(msg);
      window.alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  const exportToExcel = (includeData: boolean = true) => {
    const workbook = utils.book_new();
    
    // Sheet 1: Data (if includeData is true)
    if (includeData) {
      const dataToExport = filteredLogs.map(log => ({
        'Kode SKU': log.skuId,
        'Nomor Resi': log.receiptId,
        'Quantity': log.quantity
      }));
      
      const worksheetData = dataToExport.length > 0 
        ? utils.json_to_sheet(dataToExport)
        : utils.json_to_sheet([{ 'Kode SKU': '', 'Nomor Resi': '', 'Quantity': '' }]);
      
      utils.book_append_sheet(workbook, worksheetData, 'Data Scan');
    }

    // Sheet 2: Template Import (Always include)
    const templateData = [
      { 'Kode SKU': 'SKU-CONTOH-001', 'Nomor Resi': 'RESI123456789', 'Quantity': 1 },
      { 'Kode SKU': 'SKU-CONTOH-002', 'Nomor Resi': 'RESI987654321', 'Quantity': 2 }
    ];
    const worksheetTemplate = utils.json_to_sheet(templateData);
    utils.book_append_sheet(workbook, worksheetTemplate, 'Template Import');
    
    const fileName = includeData 
      ? `Data_Scan_Full_${new Date().toISOString().split('T')[0]}.xlsx` 
      : 'Format_Import_Data_Scan.xlsx';
      
    writeFile(workbook, fileName);
    setShowExportModal(false);
  };

  const downloadTemplate = () => {
    exportToExcel(false);
  };

  const exportBlankExcel = () => {
    exportToExcel(false);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWarehouse) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = read(data, { type: 'binary' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json = utils.sheet_to_json(worksheet) as any[];

        let successCount = 0;
        let failCount = 0;
        let dupeCount = 0;

        for (const row of json) {
          const skuCode = String(row['Kode SKU'] || row['SKU'] || '').trim().toUpperCase();
          const receiptId = String(row['Nomor Resi'] || row['barcode/no resi'] || '').trim();
          const qty = Number(row['Quantity'] || row['qty'] || row['Quantity'] || 1);
          const date = String(row['Tanggal (YYYY-MM-DD)'] || new Date().toISOString().split('T')[0]).trim();

          if (!skuCode || !receiptId) {
            failCount++;
            continue;
          }

          try {
            // Duplicate check
            const qCheck = query(
              collection(db, 'history/keluar/records'),
              where('skuId', '==', skuCode),
              where('receiptId', '==', receiptId),
              where('warehouseId', '==', activeWarehouse.id)
            );
            const checkSnap = await getDocs(qCheck);
            
            if (!checkSnap.empty) {
              dupeCount++;
              continue;
            }

            // Verify SKU exists in this warehouse
            const skuDocRef = doc(db, 'skus', `${activeWarehouse.id}_${skuCode}`);
            const skuDoc = await getDocs(query(collection(db, 'skus'), where('id', '==', skuCode), where('warehouseId', '==', activeWarehouse.id)));
            
            if (skuDoc.empty) {
              console.warn(`SKU ${skuCode} tidak ditemukan di gudang ini.`);
              failCount++;
              continue;
            }

            await processTransaction('SCAN', {
              skuId: skuCode,
              quantity: qty,
              receiptId: receiptId,
              date: date,
              warehouseId: activeWarehouse.id
            });
            successCount++;
          } catch (err) {
            console.error(`Gagal import scan ${skuCode}:`, err);
            failCount++;
          }
        }

        window.alert(`Import Selesai!\nBerhasil: ${successCount}\nDuplikat (Lewati): ${dupeCount}\nGagal: ${failCount}`);
      } catch (err) {
        console.error('Error reading excel:', err);
        window.alert('Gagal membaca file Excel.');
      } finally {
        setIsImporting(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Prime Scan Area */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
          <div className="flex items-center gap-4">
            <div className="bg-slate-100 p-3 rounded-2xl">
              <Scan className="w-6 h-6 text-slate-800" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Rapid Scan (Keluar)</h2>
              <p className="text-slate-400 font-bold uppercase tracking-widest text-[9px]">Inventory Outbound Management</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2.5 bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
             <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
             <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest leading-none">Ready</span>
          </div>
        </div>

        <form onSubmit={handleScan} className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
          <div className="md:col-span-4 space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-2">Pilih SKU</label>
            <select
              value={selectedSku}
              onChange={(e) => setSelectedSku(e.target.value)}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none transition-all font-bold text-slate-700 text-sm"
            >
              <option value="">-- PILIH BARANG --</option>
              {skus.map(sku => (
                <option key={sku.id} value={sku.id}>{sku.id} - {sku.name}</option>
              ))}
            </select>
          </div>

          <div className="md:col-span-5 space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-2">Barcode / No Resi</label>
            <input
              ref={inputRef}
              type="text"
              value={receiptId}
              onChange={(e) => setReceiptId(e.target.value)}
              placeholder="SCAN DISINI..."
              className="w-full px-5 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-black text-lg text-indigo-600 placeholder:text-slate-300"
            />
          </div>

          <div className="md:col-span-1 space-y-1.5">
            <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 ml-2 text-center block">Qty</label>
            <input
              type="number"
              value={quantity || ''}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="w-full px-2 py-3 bg-slate-50 border border-slate-200 rounded-2xl outline-none font-black text-center text-slate-700"
              min="1"
            />
          </div>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={isProcessing}
              className="w-full h-[48px] bg-slate-900 text-white font-black rounded-2xl transition-all active:scale-95 disabled:opacity-50 uppercase tracking-widest text-[10px]"
            >
              {isProcessing ? 'Proses...' : 'SIMPAN'}
            </button>
          </div>
        </form>
        
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="mt-8 p-5 bg-red-50 border-2 border-red-100 text-red-600 rounded-[2rem] flex items-center gap-4"
            >
              <div className="bg-white p-2 rounded-xl shadow-sm">
                <AlertCircle className="w-5 h-5" />
              </div>
              <span className="text-sm font-black uppercase tracking-tight">{error}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Modern List */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
         <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between px-4 flex-wrap gap-4">
               <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.3em]">Session History</h3>
                <div className="flex items-center gap-3">
                 <div className="flex items-center gap-1">
                   <button
                     onClick={() => setShowExportModal(true)}
                     className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest bg-emerald-600 text-white shadow-lg shadow-emerald-200 hover:bg-emerald-700 transition-all active:scale-95"
                   >
                     <FileDown className="w-3.5 h-3.5" />
                     Export Excel
                   </button>
                 </div>

                 <div className="flex items-center">
                   <input 
                     type="file" 
                     ref={fileInputRef} 
                     onChange={handleImport} 
                     accept=".xlsx, .xls, .csv" 
                     className="hidden" 
                   />
                   <button
                     onClick={() => fileInputRef.current?.click()}
                     disabled={isImporting}
                     className="flex items-center gap-2 px-3 py-1.5 rounded-l-lg text-[9px] font-black uppercase tracking-widest bg-indigo-50 text-indigo-600 border border-indigo-100 hover:bg-indigo-100 transition-all active:scale-95 disabled:opacity-50"
                   >
                     {isImporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                     Import
                   </button>
                   <button
                     onClick={downloadTemplate}
                     className="px-2 py-1.5 bg-indigo-50 text-indigo-400 border-y border-r border-indigo-100 rounded-r-lg hover:text-indigo-600 transition-colors"
                     title="Download Template Excel"
                   >
                     <FileQuestion className="w-3.5 h-3.5" />
                   </button>
                 </div>

                 <div className="h-4 w-px bg-slate-200 mx-1" />

                 {Object.values(filters).some(v => v !== '') && (
                    <button 
                      onClick={() => setFilters({ date: '', skuId: '', receiptId: '' })}
                      className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                    >
                      Reset
                    </button>
                 )}
                 <button 
                   onClick={() => setShowFilters(true)}
                   className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all ${
                     Object.values(filters).some(v => v !== '') 
                     ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' 
                     : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                   }`}
                 >
                   <Filter className="w-3 h-3" />
                   Filter {Object.values(filters).filter(v => v !== '').length > 0 && `(${Object.values(filters).filter(v => v !== '').length})`}
                 </button>
                 <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-50 px-2 py-1 rounded-md">Live Update</span>
               </div>
            </div>
            
            <div className="space-y-3">
              <AnimatePresence mode="popLayout" initial={false}>
                {filteredLogs.length === 0 ? (
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[2rem] p-24 text-center flex flex-col items-center justify-center"
                  >
                    <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center mb-4 text-slate-100 shadow-sm">
                      <Scan className="w-8 h-8" />
                    </div>
                    <p className="text-sm font-black text-slate-400 uppercase tracking-widest leading-loose">Data Tidak Ditemukan</p>
                    {Object.values(filters).some(v => v !== '') && (
                        <button 
                          onClick={() => setFilters({ date: '', skuId: '', receiptId: '' })}
                          className="mt-4 text-indigo-600 font-bold hover:underline text-[10px] uppercase tracking-widest"
                        >
                          Reset Semua Filter
                        </button>
                     )}
                  </motion.div>
                ) : filteredLogs.map((log) => {
                  const isGrouped = receiptCounts[log.receiptId] > 1;
                  const groupColor = getGroupColor(log.receiptId);
                  
                  return (
                    <motion.div
                      key={log.id}
                      layout
                      initial={{ opacity: 0, x: -30, scale: 0.9 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      exit={{ opacity: 0, x: 50, scale: 0.95 }}
                      transition={{ type: "spring", damping: 20, stiffness: 300 }}
                      className={`bg-white p-5 rounded-[2rem] border-2 shadow-lg shadow-slate-100 hover:shadow-xl hover:shadow-indigo-50 group flex items-center justify-between transition-all relative overflow-hidden ${
                        isGrouped ? `border-l-8 ${groupColor.replace('bg-', 'border-l-')}` : 'border-slate-100'
                      }`}
                    >
                      {/* Group Marker Badge */}
                      {isGrouped && (
                        <div className={`absolute top-0 right-[20%] text-[8px] font-black text-white px-3 py-1 rounded-b-xl uppercase tracking-widest flex items-center gap-1 ${groupColor} shadow-sm z-10`}>
                           <div className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
                           Same Order
                        </div>
                      )}

                      <div className="flex items-center gap-5">
                      <div className="w-14 h-14 bg-slate-50 rounded-2xl flex flex-col items-center justify-center border border-slate-100 group-hover:bg-indigo-50 group-hover:border-indigo-100 transition-colors">
                        <span className="text-[10px] font-black text-slate-400 leading-none">QTY</span>
                        <span className="text-xl font-black text-slate-900 leading-tight tabular-nums group-hover:text-indigo-600">{log.quantity}</span>
                      </div>
                      
                      <div className="flex flex-col">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-[10px] font-black bg-indigo-600 text-white px-2 py-0.5 rounded-md leading-none shadow-sm shadow-indigo-100 tracking-tighter tabular-nums">
                            {log.createdAt?.toDate ? log.createdAt.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Now'}
                          </span>
                          <span className="text-[9px] font-black text-slate-300 tracking-widest uppercase">{log.receiptId}</span>
                        </div>
                        <h4 className="text-base font-black text-slate-800 uppercase leading-none mb-1">{log.skuName}</h4>
                        <p className="text-[10px] font-black font-mono text-slate-400 tracking-widest">{log.skuId}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                       {confirmDeleteId === log.id ? (
                          <div className="flex items-center gap-1.5 bg-red-50 p-1 rounded-2xl border border-red-100">
                             <button
                               onClick={() => handleDelete(log.id)}
                               className="px-4 py-2 bg-red-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all active:scale-95"
                             >
                               Hapus
                             </button>
                             <button
                               onClick={() => setConfirmDeleteId(null)}
                               className="px-3 py-2 bg-white text-slate-400 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-50 transition-all"
                             >
                               X
                             </button>
                          </div>
                       ) : (
                          <button
                            onClick={() => setConfirmDeleteId(log.id)}
                            disabled={isDeleting === log.id}
                            className="w-12 h-12 flex items-center justify-center rounded-2xl text-slate-100 group-hover:text-red-200 hover:!text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                       )}
                    </div>
                  </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
         </div>

         <div className="space-y-6">
            <div className="bg-indigo-900 rounded-[2.5rem] p-8 text-white shadow-2xl shadow-indigo-200">
               <h3 className="text-[10px] font-black text-indigo-300 uppercase tracking-[0.3em] mb-6">Performance Stats</h3>
               <div className="space-y-6">
                  <div>
                    <p className="text-3xl font-black tabular-nums">{filteredLogs.length}</p>
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Successful Scans</p>
                  </div>
                  <div className="h-px bg-indigo-800" />
                  <div>
                    <p className="text-3xl font-black tabular-nums">{filteredLogs.reduce((acc, l) => acc + l.quantity, 0)}</p>
                    <p className="text-[10px] font-black text-indigo-300 uppercase tracking-widest">Total Units Out</p>
                  </div>
               </div>
               <div className="mt-8 p-4 bg-indigo-800/40 rounded-2xl border border-indigo-700/50">
                  <p className="text-[9px] font-medium text-indigo-200 leading-relaxed italic">
                    Focus on the receipt barcode for automatic ID extraction. Systematic inventory control enabled.
                  </p>
               </div>
            </div>
            
            <div className="bg-white rounded-[2rem] border-2 border-dashed border-slate-200 p-8 flex flex-col items-center justify-center text-center">
               <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-200 mb-4">
                  <Scan className="w-6 h-6" />
               </div>
               <p className="text-xs font-black text-slate-400 uppercase tracking-tighter">Ready for Hardware Scanner</p>
            </div>
         </div>
      </div>

      {/* Filter Modal */}
      <AnimatePresence>
        {showFilters && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFilters(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
               <div className="p-8">
                  <div className="flex items-center justify-between mb-8">
                     <div className="flex items-center gap-3">
                        <div className="bg-indigo-100 p-2 rounded-xl text-indigo-600">
                           <Filter className="w-5 h-5" />
                        </div>
                        <div>
                           <h3 className="text-xl font-black text-slate-900">Filter Rapid Scan</h3>
                           <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Pencarian Spesifik</p>
                        </div>
                     </div>
                     <button 
                       onClick={() => setFilters({ date: '', skuId: '', receiptId: '' })}
                       className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
                     >
                       Reset Filter
                     </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                     {/* Calendar Date Picker */}
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Pilih Tanggal</label>
                        <input 
                           type="date"
                           value={filters.date}
                           onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:border-indigo-400 outline-none cursor-pointer"
                        />
                     </div>

                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Inventory Item</label>
                        <select 
                           value={filters.skuId}
                           onChange={(e) => setFilters(prev => ({ ...prev, skuId: e.target.value }))}
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none appearance-none cursor-pointer"
                        >
                           <option value="">Semua Item</option>
                           {uniqueItems.map(id => (
                              <option key={id} value={id}>{id} | {logs.find(l => l.skuId === id)?.skuName || id}</option>
                           ))}
                        </select>
                     </div>

                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Barcode / Order ID</label>
                        <input 
                           type="text"
                           value={filters.receiptId}
                           onChange={(e) => setFilters(prev => ({ ...prev, receiptId: e.target.value }))}
                           placeholder="Cari nomor order/resi..."
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                        />
                     </div>
                  </div>

                  <button 
                    onClick={() => setShowFilters(false)}
                    className="w-full mt-8 bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-indigo-100 hover:bg-slate-900 transition-all uppercase tracking-widest text-[10px]"
                  >
                    Terapkan Filter
                  </button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Export Modal */}
      <AnimatePresence>
        {showExportModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowExportModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-white rounded-[2.5rem] shadow-2xl overflow-hidden"
            >
               <div className="p-8">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="bg-emerald-100 p-2 rounded-xl text-emerald-600">
                      <FileDown className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-slate-900 leading-tight">Export Excel</h3>
                      <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Rapid Scan Data</p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <button
                      onClick={() => exportToExcel(true)}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-emerald-50 border-2 border-slate-100 hover:border-emerald-200 rounded-2xl transition-all group"
                    >
                      <div className="text-left">
                        <p className="font-black text-slate-700 group-hover:text-emerald-700 text-sm">Download Data & Template</p>
                        <p className="text-[10px] text-slate-400">Berisi data scan saat ini + Template Import</p>
                      </div>
                      <FileDown className="w-5 h-5 text-slate-300 group-hover:text-emerald-500" />
                    </button>

                    <button
                      onClick={() => exportToExcel(false)}
                      className="w-full flex items-center justify-between p-4 bg-slate-50 hover:bg-indigo-50 border-2 border-slate-100 hover:border-indigo-200 rounded-2xl transition-all group"
                    >
                      <div className="text-left">
                        <p className="font-black text-slate-700 group-hover:text-indigo-700 text-sm">Download Template Saja</p>
                        <p className="text-[10px] text-slate-400">Hanya format kosong (Kode SKU, Resi, Qty)</p>
                      </div>
                      <FileQuestion className="w-5 h-5 text-slate-300 group-hover:text-indigo-500" />
                    </button>
                  </div>

                  <button
                    onClick={() => setShowExportModal(false)}
                    className="w-full mt-6 py-3 text-slate-400 font-black text-[10px] uppercase tracking-widest hover:text-slate-600 transition-colors"
                  >
                    Batalkan
                  </button>
               </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DataScan;
