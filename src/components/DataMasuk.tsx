import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { processTransaction, deleteTransaction } from '../services/rekapService';
import { SKU } from '../types';
import { Trash2, Download, AlertCircle, Filter, X, ChevronDown, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface LogEntry {
  id: string;
  skuId: string;
  skuName: string;
  quantity: number;
  receiptId: string;
  date: string;
  createdAt: any;
  type?: string;
  isHoldRelease?: boolean;
  pcsPerCarton?: number;
  inputMode?: 'PCS' | 'CARTON';
}

const DataMasuk: React.FC = () => {
  const { activeWarehouse } = useWarehouse();
  const [skus, setSkus] = useState<SKU[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [inputMode, setInputMode] = useState<'PCS' | 'CARTON'>('PCS');
  const [numCartons, setNumCartons] = useState(0);
  const [pcsPerCartonOverride, setPcsPerCartonOverride] = useState(1);
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'LOG' | 'BATCH' | 'SUMMARY'>('LOG');
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

  // Grouping logic for BATCH view
  const logsByBatch = filteredLogs.reduce((acc, log) => {
    const key = `${log.receiptId}-${log.date}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {} as Record<string, LogEntry[]>);

  const batches = (Object.entries(logsByBatch) as [string, LogEntry[]][]).sort((a, b) => {
    // Sort by the max createdAt in each batch
    const maxA = Math.max(...a[1].map((l: LogEntry) => l.createdAt?.toMillis?.() || 0));
    const maxB = Math.max(...b[1].map((l: LogEntry) => l.createdAt?.toMillis?.() || 0));
    return maxB - maxA;
  });

  // Summary logic for items processed
  const summaryBySku = filteredLogs.reduce((acc, log) => {
    const key = log.skuId;
    if (!acc[key]) {
      acc[key] = {
        skuId: log.skuId,
        skuName: log.skuName,
        totalQty: 0,
        transactions: 0
      };
    }
    acc[key].totalQty += log.quantity;
    acc[key].transactions += 1;
    return acc;
  }, {} as Record<string, { skuId: string; skuName: string; totalQty: number; transactions: number }>);

  const summaryData = (Object.values(summaryBySku) as { skuId: string; skuName: string; totalQty: number; transactions: number }[])
    .sort((a, b) => b.totalQty - a.totalQty);

  useEffect(() => {
    if (!activeWarehouse) return;

    const unsubSkus = onSnapshot(query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id)), (snap) => {
      setSkus(snap.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id.split('_').slice(1).join('_') } as SKU;
      }));
    }, (error) => {
      console.error("Error fetching skus in DataMasuk:", error);
      handleFirestoreError(error, OperationType.LIST, 'skus');
    });

    // Increased limit for better filtering experience
    const q = query(
      collection(db, 'history/masuk/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsubLogs = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LogEntry)));
    }, (error) => {
      console.error("Error fetching logs in DataMasuk:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/masuk/records');
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
      await deleteTransaction('MASUK', id);
    } catch (err) {
      console.error(err);
      const msg = 'Gagal menghapus data masuk.';
      setError(msg);
      window.alert(`Peringatan: ${msg}`);
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedSku) {
      window.alert('Pilih SKU!');
      return setError('Pilih SKU!');
    }
    if (!documentNo) {
      window.alert('Isi nomor dokumen!');
      return setError('Isi nomor dokumen!');
    }
    if (quantity <= 0) {
      window.alert('Jumlah harus lebih dari 0!');
      return setError('Jumlah harus lebih dari 0!');
    }

    if (!activeWarehouse) {
      window.alert('Pilih gudang terlebih dahulu!');
      return setError('Pilih gudang terlebih dahulu!');
    }

    setIsProcessing(true);
    try {
      await processTransaction('MASUK', {
        skuId: selectedSku,
        quantity,
        receiptId: documentNo,
        date,
        warehouseId: activeWarehouse.id,
        ...(inputMode === 'CARTON' ? { pcsPerCarton: pcsPerCartonOverride } : {})
      });
      setDocumentNo('');
      setQuantity(0);
      setNumCartons(0);
    } catch (err) {
      const msg = 'Gagal memproses data masuk.';
      setError(msg);
      window.alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
      {/* Operations Panel */}
      <div className="xl:col-span-4 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 overflow-hidden">
          <div className="flex items-center gap-4 mb-8">
            <div className="bg-emerald-500 w-2 h-7 rounded-full" />
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none italic uppercase">Stock <span className="text-emerald-500">IN</span></h2>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Manual Inventory Entry</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Tanggal</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-emerald-500 transition-all font-bold text-sm text-slate-700 shadow-sm"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Referensi</label>
                <input
                  type="text"
                  value={documentNo}
                  onChange={(e) => setDocumentNo(e.target.value)}
                  placeholder="ID NOTA / SJ"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-emerald-500 transition-all font-bold text-sm text-slate-700 shadow-sm placeholder:text-slate-200 placeholder:font-black uppercase"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Nama Barang / SKU</label>
                <div className="relative group">
                   <select
                    value={selectedSku}
                    onChange={(e) => {
                      const skuId = e.target.value;
                      setSelectedSku(skuId);
                      const sku = skus.find(s => s.id === skuId);
                      if (sku) {
                        setPcsPerCartonOverride(sku.pcsPerCarton || 1);
                      }
                    }}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-emerald-500 transition-all font-black text-sm text-slate-700 appearance-none shadow-sm uppercase tabular-nums"
                  >
                    <option value="">-- [ PILIH ITEM ] --</option>
                    {skus.map(sku => (
                      <option key={sku.id} value={sku.id}>{sku.id} | {sku.name} (Isi: {sku.pcsPerCarton || 1})</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                    <Download className="w-4 h-4 rotate-180" />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setInputMode('PCS')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${inputMode === 'PCS' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                  >
                    Pcs (Eceran)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('CARTON')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${inputMode === 'CARTON' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}
                  >
                    Input Dus (Box)
                  </button>
                </div>

                {inputMode === 'PCS' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-center block w-full">Jumlah QTY (PCS)</label>
                      <input
                        type="number"
                        value={quantity || ''}
                        onChange={(e) => setQuantity(Number(e.target.value))}
                        placeholder="0"
                        className="w-full px-4 py-5 bg-slate-50/50 border border-slate-100 rounded-2xl focus:ring-0 focus:border-emerald-500 focus:bg-white transition-all font-black text-3xl text-emerald-600 placeholder:text-slate-100 tabular-nums text-center"
                        min="1"
                      />
                    </div>
                    <div className="flex justify-center -mt-2">
                       <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest border-t border-slate-100 pt-2 px-4 italic text-center">
                         * Otomatis dialokasikan ke isian stok terendah
                       </span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2 text-center">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Jml Dus</label>
                      <input
                        type="number"
                        value={numCartons || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setNumCartons(val);
                          setQuantity(val * pcsPerCartonOverride);
                        }}
                        placeholder="0"
                        className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-xl focus:border-emerald-500 focus:bg-white transition-all font-black text-2xl text-emerald-600 text-center"
                      />
                    </div>
                    <div className="space-y-2 text-center">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">PCS/Dus</label>
                      <div className="relative">
                        <input
                          type="number"
                          list="carton-sizes-masuk"
                          value={pcsPerCartonOverride || ''}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setPcsPerCartonOverride(val);
                            setQuantity(numCartons * val);
                          }}
                          placeholder="1"
                          className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-xl focus:border-emerald-500 focus:bg-white transition-all font-black text-2xl text-emerald-600 text-center"
                        />
                        <datalist id="carton-sizes-masuk">
                          {(() => {
                            const sku = skus.find(s => s.id === selectedSku);
                            const sizes = Array.from(new Set([sku?.pcsPerCarton, ...(sku?.cartonSizes || [])])).filter(s => s && s > 0).sort((a, b) => a - b);
                            return sizes.map(size => <option key={size} value={size}>{size} PCS / Dus</option>);
                          })()}
                        </datalist>
                      </div>
                    </div>
                    {numCartons > 0 && (
                      <div className="col-span-2 text-center -mt-1">
                        <span className="text-[11px] font-black text-emerald-600/50 uppercase tracking-[0.2em] italic">
                          Total: {quantity} PCS
                        </span>
                      </div>
                    )}
                  </div>
                )}
                
                {selectedSku && quantity > 0 && inputMode === 'PCS' && (
                  <div className="hidden">
                    {/* Size selection is handled automatically in the background */}
                  </div>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full bg-[#111827] hover:bg-black text-white font-black py-5 rounded-xl transition-all shadow-2xl shadow-slate-200 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-[0.3em] text-[11px]"
            >
              {isProcessing ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Processing...
                </>
              ) : 'Proses Input'}
            </button>
          </form>

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-xs font-bold leading-tight">{error}</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Activity Stream */}
      <div className="xl:col-span-8 flex flex-col min-h-[500px]">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
          <div className="px-8 py-4 bg-white flex items-center justify-between border-b border-slate-50">
            <div className="flex bg-slate-100/50 p-1 rounded-xl border border-slate-200/50">
              <button 
                onClick={() => setViewMode('LOG')}
                className={`px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em] rounded-lg transition-all ${
                  viewMode === 'LOG' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-500'
                }`}
              >
                Journal
              </button>
              <button 
                onClick={() => setViewMode('BATCH')}
                className={`px-6 py-2 text-[10px] font-black uppercase tracking-[0.2em] rounded-lg transition-all ${
                  viewMode === 'BATCH' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-500'
                }`}
              >
                Transaksi
              </button>
            </div>
            
            <div className="flex items-center gap-2">
               {Object.values(filters).some(v => v !== '') && (
                  <button 
                    onClick={() => setFilters({ date: '', skuId: '', receiptId: '' })}
                    className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                  >
                    Reset Filter
                  </button>
               )}
               <button 
                 onClick={() => setShowFilters(true)}
                 className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    Object.values(filters).some(v => v !== '') 
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-200' 
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                 }`}
               >
                 <Filter className="w-3 h-3" />
                 Filter {Object.values(filters).filter(v => v !== '').length > 0 && `(${Object.values(filters).filter(v => v !== '').length})`}
               </button>
            </div>
          </div>
          
          <div className="overflow-x-auto flex-1">
            {viewMode === 'LOG' ? (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-slate-50/10 text-slate-300 text-[10px] uppercase font-bold tracking-[0.2em]">
                    <th className="px-10 py-6 border-b border-slate-50">Waktu</th>
                    <th className="px-8 py-6 border-b border-slate-50">Detail Barang</th>
                    <th className="px-8 py-6 border-b border-slate-50">Ref / Nota</th>
                    <th className="px-8 py-6 border-b border-slate-50 text-center">Carton/Dus</th>
                    <th className="px-10 py-6 border-b border-slate-50 text-right"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {filteredLogs.length === 0 ? (
                      <tr key="empty">
                         <td colSpan={5} className="py-24 text-center">
                            <div className="flex flex-col items-center justify-center py-12">
                               <Download className="w-16 h-16 mb-4 text-slate-100" />
                               <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Data Tidak Ditemukan</p>
                               {Object.values(filters).some(v => v !== '') && (
                                  <button 
                                    onClick={() => setFilters({ date: '', skuId: '', receiptId: '' })}
                                    className="mt-4 text-indigo-600 font-bold hover:underline text-[10px] uppercase tracking-widest"
                                  >
                                    Reset Semua Filter
                                  </button>
                               )}
                            </div>
                         </td>
                      </tr>
                    ) : filteredLogs.map((log) => (
                      <motion.tr
                        key={log.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="group hover:bg-slate-50/20 transition-colors"
                      >
                        <td className="px-10 py-6 whitespace-nowrap">
                          <div className="flex flex-col">
                             <span className="text-[13px] font-black text-slate-900 mb-0.5 tabular-nums">{log.date}</span>
                             <span className="text-[10px] text-slate-400 font-bold tabular-nums opacity-60">
                               {log.createdAt?.toDate ? log.createdAt.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/\./g, '.') : '00.00.00'}
                             </span>
                          </div>
                        </td>
                        <td className="px-8 py-6">
                           <div className="flex flex-col max-w-[200px]">
                             <span className="text-[13px] font-black text-[#059669] uppercase leading-none mb-1 truncate">{log.skuName}</span>
                             <div className="flex items-center gap-1.5">
                               <span className="text-[10px] font-bold font-mono text-slate-300">#{log.skuId}</span>
                               {log.isHoldRelease && (
                                 <span className="text-[8px] font-black bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded border border-amber-100 uppercase tracking-tighter shrink-0">
                                   Pelepasan Hold
                                 </span>
                               )}
                             </div>
                           </div>
                        </td>
                        <td className="px-8 py-6">
                          <span className="text-[10px] font-black text-slate-600 tabular-nums border border-slate-200 px-3 py-1.5 rounded-md bg-white shadow-sm uppercase tracking-tighter">
                               {log.receiptId}
                          </span>
                        </td>
                        <td className="px-8 py-6">
                          <div className="flex items-center justify-center">
                             <div className="flex flex-col items-center">
                                {(() => {
                                  const sku = skus.find(s => s.id === log.skuId);
                                  const perCarton = log.pcsPerCarton || sku?.pcsPerCarton || 1;
                                  
                                  if (log.inputMode === 'PCS') {
                                    return (
                                      <div className="flex flex-col items-center">
                                        <div className="text-[#059669] font-black text-2xl flex items-center tabular-nums">
                                           <span className="text-[14px] mr-1 opacity-40 font-bold">+</span>
                                           {log.quantity} <span className="text-[10px] ml-1 opacity-60">PCS</span>
                                        </div>
                                        <div className="flex flex-col items-center mt-1">
                                          <span className="text-[8px] font-black bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full border border-emerald-100 uppercase tracking-tighter">
                                            Eceran
                                          </span>
                                          <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter mt-1">
                                            (Ke Isian {perCarton} - Stok Terendah)
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  }

                                  const dus = Math.floor(log.quantity / perCarton);
                                  const sisa = log.quantity % perCarton;
                                  return (
                                    <>
                                      <div className="text-[#059669] font-black text-2xl flex items-center tabular-nums">
                                         <span className="text-[14px] mr-1 opacity-40 font-bold">+</span>
                                         {dus} <span className="text-[10px] ml-1 opacity-60">DUS</span>
                                      </div>
                                      <div className="flex flex-col items-center mt-1">
                                        {sisa > 0 && (
                                          <span className="text-[9px] font-black text-emerald-500 uppercase tracking-widest leading-none">
                                            + {sisa} PCS
                                          </span>
                                        )}
                                        <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter mt-0.5">
                                          Total: {log.quantity} PCS
                                          {log.pcsPerCarton && log.pcsPerCarton !== sku?.pcsPerCarton && ` (Isi ${log.pcsPerCarton})`}
                                        </span>
                                      </div>
                                    </>
                                  );
                                })()}
                             </div>
                          </div>
                        </td>
                        <td className="px-10 py-6 text-right">
                            <div className="flex items-center justify-end">
                              {confirmDeleteId === log.id ? (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleDelete(log.id)}
                                    className="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg shadow-lg active:scale-95"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setConfirmDeleteId(null)}
                                    className="w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-900 transition-colors"
                                  >
                                    <span className="text-[10px] font-black uppercase tracking-widest">Esc</span>
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setConfirmDeleteId(log.id)}
                                  disabled={isDeleting === log.id}
                                  className="w-9 h-9 flex items-center justify-center text-slate-100 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100 disabled:opacity-30"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                      </motion.tr>
                    ))}
                  </AnimatePresence>
                </tbody>
              </table>
            ) : viewMode === 'BATCH' ? (
              <div className="p-6 space-y-4">
                {batches.length === 0 ? (
                  <div className="py-32 text-center">
                    <Download className="w-12 h-12 mx-auto mb-4 text-slate-100" />
                    <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Belum Ada Transaksi</p>
                  </div>
                ) : batches.map(([key, items]) => (
                  <motion.div 
                    key={key} 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="border border-slate-100 rounded-xl overflow-hidden shadow-sm"
                  >
                    <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                       <div className="flex items-center gap-3">
                         <div className="bg-emerald-600 text-white px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-[0.2em] shadow-sm">
                           {items[0].receiptId}
                         </div>
                         <span className="text-[10px] font-black text-slate-400 tabular-nums uppercase tracking-widest">{items[0].date}</span>
                       </div>
                       <div className="text-[9px] font-black text-slate-300 uppercase tracking-widest">
                         {items.length} ITEM ENTRY
                       </div>
                    </div>
                    <div className="divide-y divide-slate-50 bg-white">
                      {items.map(item => (
                        <div key={item.id} className="px-5 py-3.5 flex items-center justify-between group hover:bg-slate-50/50 transition-colors">
                           <div className="flex flex-col">
                             <span className="text-[11px] font-black text-slate-800 uppercase leading-none mb-1 group-hover:text-emerald-600 transition-colors">{item.skuName}</span>
                             <div className="flex items-center gap-1.5">
                               <span className="text-[9px] font-black font-mono text-slate-400 tracking-[0.2em] leading-none">#{item.skuId}</span>
                               {item.isHoldRelease && (
                                 <span className="text-[7px] font-black bg-amber-50 text-amber-600 px-1 py-0.5 rounded border border-amber-100 uppercase tracking-tighter">
                                   Pelepasan Hold
                                 </span>
                               )}
                             </div>
                           </div>
                           <div className="flex items-center gap-5">
                             <div className="text-right">
                               {(() => {
                                 const sku = skus.find(s => s.id === item.skuId);
                                 const perCarton = item.pcsPerCarton || sku?.pcsPerCarton || 1;
                                 
                                 if (item.inputMode === 'PCS') {
                                   return (
                                     <div className="flex flex-col items-end">
                                       <div className="flex items-center justify-end font-black text-emerald-600 tabular-nums leading-none">
                                         <span className="text-[15px]">{item.quantity}</span>
                                         <span className="text-[9px] ml-1 opacity-60">PCS</span>
                                       </div>
                                       <div className="flex flex-col items-end mt-1">
                                         <span className="text-[6px] font-black bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded-full border border-emerald-100 uppercase tracking-tighter">
                                           ECERAN
                                         </span>
                                         <p className="text-[7px] font-black text-slate-300 uppercase tracking-tighter leading-none mt-1">
                                           (KE ISIAN {perCarton} - STOK TERENDAH)
                                         </p>
                                       </div>
                                     </div>
                                   );
                                 }

                                 const dus = Math.floor(item.quantity / perCarton);
                                 const sisa = item.quantity % perCarton;
                                 return (
                                   <>
                                     <div className="flex items-center justify-end font-black text-emerald-600 tabular-nums leading-none">
                                       <span className="text-[15px]">{dus}</span>
                                       <span className="text-[9px] ml-1 opacity-60">DUS</span>
                                     </div>
                                     <p className="text-[8px] font-black text-slate-400 uppercase tracking-tighter leading-none mt-1">
                                       {sisa > 0 ? `+ ${sisa} PCS` : `${item.quantity} PCS`}
                                       {item.pcsPerCarton && item.pcsPerCarton !== sku?.pcsPerCarton && ` (ISI ${item.pcsPerCarton})`}
                                     </p>
                                   </>
                                 );
                               })()}
                             </div>
                             <button
                                onClick={() => setConfirmDeleteId(item.id)}
                                className="w-7 h-7 flex items-center justify-center text-slate-200 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                           </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="p-6">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-slate-400 text-[9px] uppercase font-black tracking-widest border-b border-slate-100">
                      <th className="px-3 py-3">Nama Barang</th>
                      <th className="px-3 py-3 text-center">Frek</th>
                      <th className="px-3 py-3 text-right">Masuk</th>
                      <th className="px-3 py-3 text-right">Stok Jual</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {summaryData.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-32 text-center">
                            <div className="flex flex-col items-center justify-center">
                               <Download className="w-12 h-12 mb-4 text-slate-100" />
                               <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Ringkasan Kosong</p>
                            </div>
                        </td>
                      </tr>
                    ) : summaryData.map((item) => {
                      const actualSku = skus.find(s => s.id === item.skuId);
                      return (
                        <tr key={item.skuId} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-3 py-4">
                            <div className="flex flex-col">
                              <span className="text-[11px] font-black text-slate-900 uppercase truncate max-w-[260px] group-hover:text-emerald-600 transition-colors">{item.skuName}</span>
                              <span className="text-[9px] font-black font-mono text-slate-400 tracking-[0.1em] tabular-nums mt-0.5">#{item.skuId}</span>
                            </div>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[9px] font-black tracking-wider uppercase">{item.transactions} Trans</span>
                          </td>
                          <td className="px-3 py-4 text-right">
                             <div className="flex flex-col items-end">
                                <span className="text-emerald-600 font-black text-[15px] tabular-nums tracking-tighter">+{item.totalQty}</span>
                                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">Masuk</span>
                             </div>
                          </td>
                          <td className="px-3 py-4 text-right">
                             <div className="flex flex-col items-end">
                                <span className="text-slate-900 font-black text-[15px] tabular-nums tracking-tighter">{actualSku?.currentStock?.toLocaleString() || 0}</span>
                                <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">Stok Jual</span>
                             </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
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
                           <h3 className="text-xl font-black text-slate-900">Filter Data Masuk</h3>
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
                     {/* Date Picker */}
                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1 text-center block">Pilih Tanggal</label>
                        <input 
                           type="date"
                           value={filters.date}
                           onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))}
                           className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4 text-sm font-black text-slate-900 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all cursor-pointer text-center"
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
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Reference / Nota</label>
                        <input 
                           type="text"
                           value={filters.receiptId}
                           onChange={(e) => setFilters(prev => ({ ...prev, receiptId: e.target.value }))}
                           placeholder="Cari nomor dokumen..."
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
    </div>
  );
};

export default DataMasuk;
