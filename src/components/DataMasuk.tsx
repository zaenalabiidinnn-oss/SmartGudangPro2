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
  const [extraPcs, setExtraPcs] = useState(0);
  const [pcsPerCartonOverride, setPcsPerCartonOverride] = useState(0);
  
  // Track selected category pile (Source/Target Size)
  const [selectedCategorySize, setSelectedCategorySize] = useState<number | null>(null);

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);

  const selectedSkuData = skus.find(s => s.id === selectedSku);
  const existingMultipliers = Array.from(new Set([
    1,
    ...(selectedSkuData?.pcsPerCarton && selectedSkuData.pcsPerCarton > 1 ? [selectedSkuData.pcsPerCarton] : []),
    ...(selectedSkuData?.detailedStock ? Object.keys(selectedSkuData.detailedStock).map(Number) : [])
  ]))
  .filter(n => n >= 1)
  .sort((a, b) => b - a);
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

  const uniqueItems = Array.from(new Set(logs.map(l => l.skuId))).filter(Boolean).sort();

  const filteredLogs = logs.filter(log => {
    const logDate = log.date || '';
    const matchesDate = !filters.date || logDate === filters.date;
    const matchesSku = !filters.skuId || log.skuId === filters.skuId;
    const matchesRef = !filters.receiptId || log.receiptId?.toLowerCase().includes(filters.receiptId.toLowerCase());
    return matchesDate && matchesSku && matchesRef;
  });

  const logsByBatch = filteredLogs.reduce((acc, log) => {
    const key = `${log.receiptId}-${log.date}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(log);
    return acc;
  }, {} as Record<string, LogEntry[]>);

  const batches = (Object.entries(logsByBatch) as [string, LogEntry[]][]).sort((a, b) => {
    const maxA = Math.max(...a[1].map((l: LogEntry) => l.createdAt?.toMillis?.() || 0));
    const maxB = Math.max(...b[1].map((l: LogEntry) => l.createdAt?.toMillis?.() || 0));
    return maxB - maxA;
  });

  const summaryBySku = filteredLogs.reduce((acc, log) => {
    const key = log.skuId;
    if (!acc[key]) {
      acc[key] = { skuId: log.skuId, skuName: log.skuName, totalQty: 0, transactions: 0 };
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
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'skus'));

    const q = query(
      collection(db, 'history/masuk/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsubLogs = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LogEntry)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'history/masuk/records'));

    return () => { unsubSkus(); unsubLogs(); };
  }, [activeWarehouse]);

  const handleDelete = async (id: string) => {
    setConfirmDeleteId(null);
    setIsDeleting(id);
    try {
      await deleteTransaction('MASUK', id);
    } catch (err) {
      setError('Gagal menghapus data masuk.');
      window.alert('Peringatan: Gagal menghapus data masuk.');
    } finally { setIsDeleting(null); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSku || !documentNo || quantity <= 0 || !activeWarehouse) {
      window.alert('Mohon lengkapi form input!');
      return;
    }
    setIsProcessing(true);
    try {
      await processTransaction('MASUK', {
        skuId: selectedSku,
        quantity,
        receiptId: documentNo,
        date,
        warehouseId: activeWarehouse.id,
        pcsPerCarton: inputMode === 'CARTON' ? (pcsPerCartonOverride || 1) : (selectedCategorySize || 1)
      });
      setDocumentNo('');
      setQuantity(0);
      setNumCartons(0);
      setExtraPcs(0);
      setSelectedCategorySize(null);
    } catch (err) {
      setError('Gagal memproses data masuk.');
      window.alert('Gagal memproses data masuk.');
    } finally { setIsProcessing(false); }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
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
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-4 py-3 border border-slate-200 rounded-xl font-bold text-sm" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Referensi</label>
                <input type="text" value={documentNo} onChange={(e) => setDocumentNo(e.target.value)} placeholder="ID NOTA / SJ" className="w-full px-4 py-3 border border-slate-200 rounded-xl font-bold text-sm uppercase" />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">Nama Barang / SKU</label>
                <select 
                  value={selectedSku} 
                  onChange={(e) => {
                    const skuId = e.target.value;
                    setSelectedSku(skuId);
                  }} 
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl font-black text-sm uppercase"
                >
                  <option value="">-- [ PILIH ITEM ] --</option>
                  {skus.map(sku => (
                    <option key={sku.id} value={sku.id}>{sku.id} | {sku.name} (Isi: {sku.pcsPerCarton || 1})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-4 pt-2">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button type="button" onClick={() => { setInputMode('PCS'); setSelectedCategorySize(null); }} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg ${inputMode === 'PCS' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>Pcs (Eceran)</button>
                  <button type="button" onClick={() => { setInputMode('CARTON'); setPcsPerCartonOverride(selectedSkuData?.pcsPerCarton || 0); }} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-lg ${inputMode === 'CARTON' ? 'bg-white text-emerald-600 shadow-sm' : 'text-slate-400'}`}>Input Dus (Box)</button>
                </div>
                {inputMode === 'PCS' ? (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase text-slate-400 text-center block w-full">
                        Jumlah QTY (PCS) {selectedCategorySize && selectedCategorySize > 1 ? `- Kategori Isi ${selectedCategorySize}` : '- Eceran'}
                      </label>
                      <input type="number" value={quantity || ''} onChange={(e) => setQuantity(Number(e.target.value))} placeholder="0" className="w-full px-4 py-5 border border-slate-100 rounded-2xl font-black text-3xl text-emerald-600 text-center" />
                    </div>

                    {existingMultipliers.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block text-center italic">Pilih Kategori Stok (Isi Terdaftar)</label>
                        <div className="flex flex-wrap gap-2 justify-center">
                          {existingMultipliers.map(size => (
                            <button
                              key={size}
                              type="button"
                              onClick={() => {
                                setSelectedCategorySize(size);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${selectedCategorySize === size || (size === 1 && !selectedCategorySize) ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300'}`}
                            >
                              {size === 1 ? 'ECERAN' : `ISI ${size}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2 text-center">
                        <label className="text-[10px] font-black uppercase text-slate-400">Jml Dus</label>
                        <input type="number" value={numCartons || ''} onChange={(e) => { const val = Number(e.target.value); setNumCartons(val); setQuantity((val * (pcsPerCartonOverride || 0)) + extraPcs); }} placeholder="0" className="w-full px-4 py-4 border border-slate-100 rounded-xl font-black text-2xl text-emerald-600 text-center" />
                      </div>
                      <div className="space-y-2 text-center">
                        <label className="text-[10px] font-black uppercase text-slate-400">Pcs Sisa</label>
                        <input type="number" value={extraPcs || ''} onChange={(e) => { const val = Number(e.target.value); setExtraPcs(val); setQuantity((numCartons * (pcsPerCartonOverride || 0)) + val); }} placeholder="0" className="w-full px-4 py-4 border border-slate-100 rounded-xl font-black text-2xl text-emerald-600 text-center" />
                      </div>
                    </div>

                    {existingMultipliers.length > 0 && (
                      <div className="space-y-2">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 block text-center italic">Pilih Isi Terdaftar</label>
                        <div className="flex flex-wrap gap-2 justify-center">
                          {existingMultipliers.map(size => (
                            <button
                              key={size}
                              type="button"
                              onClick={() => {
                                setPcsPerCartonOverride(size);
                                const newNum = numCartons === 0 ? 1 : numCartons;
                                if (numCartons === 0) setNumCartons(1);
                                setQuantity((newNum * size) + extraPcs);
                              }}
                              className={`px-3 py-1.5 rounded-lg text-[10px] font-black border transition-all ${pcsPerCartonOverride === size ? 'bg-emerald-600 border-emerald-600 text-white shadow-md' : 'bg-white border-slate-200 text-slate-500 hover:border-emerald-300'}`}
                            >
                              {size === 1 ? 'ECERAN' : `ISI ${size}`}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2 text-center bg-slate-50 p-4 rounded-xl border border-slate-100">
                      <label className="text-[10px] font-black uppercase text-slate-400">Isi Per Dus (Multiplier)</label>
                      <input type="number" value={pcsPerCartonOverride || ''} onChange={(e) => { const val = Number(e.target.value); setPcsPerCartonOverride(val); setQuantity((numCartons * (val || 0)) + extraPcs); }} placeholder="Isi per dus" className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl font-black text-xl text-emerald-600 text-center" />
                    </div>
                  </div>
                )}
              </div>
              {quantity > 0 && (
                <div className="pt-2">
                  <div className="bg-emerald-50/50 rounded-2xl border border-emerald-100 p-4 text-center">
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-1">Total Masuk</p>
                    <p className="text-xl font-black text-emerald-600 tabular-nums">
                      {inputMode === 'CARTON' 
                        ? `${numCartons} DUS ${extraPcs > 0 ? `+ ${extraPcs} PCS` : ''} (ISI ${pcsPerCartonOverride})` 
                        : `${quantity.toLocaleString()} PCS`}
                    </p>
                  </div>
                </div>
              )}
            </div>
            <button type="submit" disabled={isProcessing} className="w-full bg-[#111827] text-white font-black py-5 rounded-xl uppercase tracking-[0.3em] text-[11px] flex items-center justify-center gap-2">
              {isProcessing ? 'Processing...' : 'Proses Input'}
            </button>
          </form>
          {error && <div className="mt-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold">{error}</div>}
        </div>
      </div>

      <div className="xl:col-span-8 flex flex-col min-h-[500px]">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-full">
          <div className="px-8 py-4 bg-white flex items-center justify-between border-b border-slate-50">
            <div className="flex bg-slate-100/50 p-1 rounded-xl">
              {['LOG', 'BATCH', 'SUMMARY'].map(mode => (
                <button key={mode} onClick={() => setViewMode(mode as any)} className={`px-6 py-2 text-[10px] font-black uppercase rounded-lg ${viewMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400'}`}>{mode}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowFilters(true)} className="bg-slate-100 text-slate-600 px-4 py-2 rounded-xl text-[10px] font-black uppercase"><Filter className="w-3 h-3 inline mr-1" /> Filter</button>
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
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="group hover:bg-slate-50/20">
                      <td className="px-10 py-6">
                        <div className="flex flex-col">
                          <span className="text-[13px] font-black text-slate-900">{log.date}</span>
                          <span className="text-[10px] text-slate-400 font-bold">
                            {log.createdAt?.toDate ? log.createdAt.toDate().toLocaleTimeString('id-ID') : '00:00:00'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <div className="flex flex-col">
                          <span className="text-[13px] font-black text-[#059669] uppercase">{log.skuName}</span>
                          <span className="text-[10px] font-bold text-slate-300">#{log.skuId}</span>
                        </div>
                      </td>
                      <td className="px-8 py-6">
                        <span className="text-[10px] font-black text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md">{log.receiptId}</span>
                      </td>
                      <td className="px-8 py-6 text-center">
                        <div className="flex flex-col items-center">
                          {(() => {
                            const sku = skus.find(s => s.id === log.skuId);
                            const perCarton = log.pcsPerCarton || sku?.pcsPerCarton || 1;

                            if (perCarton <= 1 || log.inputMode === 'PCS') {
                              return (
                                <div className="flex flex-col items-center">
                                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 uppercase tracking-widest whitespace-nowrap">
                                    0 DUS
                                  </span>
                                  <span className="text-[8px] font-bold text-emerald-500 uppercase mt-0.5 tabular-nums">
                                    + {log.quantity} PCS
                                  </span>
                                </div>
                              );
                            }

                            const dus = Math.floor(log.quantity / perCarton);
                            const sisa = log.quantity % perCarton;
                            return (
                              <div className="flex flex-col items-center">
                                <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 uppercase tracking-widest whitespace-nowrap">
                                  + {dus} DUS
                                </span>
                                {sisa > 0 && (
                                  <span className="text-[8px] font-bold text-emerald-500 uppercase mt-0.5 tabular-nums">
                                    + {sisa} PCS
                                  </span>
                                )}
                                <span className="text-[7px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5 leading-none shadow-sm">
                                  Total: {log.quantity} PCS (Isi {perCarton})
                                </span>
                              </div>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-10 py-6 text-right">
                        {confirmDeleteId === log.id ? (
                           <button onClick={() => handleDelete(log.id)} className="bg-red-600 text-white p-2 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                        ) : (
                           <button onClick={() => setConfirmDeleteId(log.id)} className="text-slate-100 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : viewMode === 'BATCH' ? (
               <div className="p-6 space-y-4">
                 {batches.map(([key, items]) => (
                   <div key={key} className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
                     <div className="px-5 py-3 bg-slate-50 border-b border-slate-100 flex justify-between">
                       <span className="bg-emerald-600 text-white px-2 py-0.5 rounded text-[9px] font-black">{items[0].receiptId}</span>
                       <span className="text-[10px] font-black text-slate-400">{items[0].date}</span>
                     </div>
                     <div className="divide-y divide-slate-50 bg-white">
                        {items.map(item => (
                          <div key={item.id} className="px-5 py-3.5 flex justify-between group hover:bg-slate-50/50">
                            <div className="flex flex-col">
                              <span className="text-[11px] font-black text-slate-800 uppercase">{item.skuName}</span>
                              <span className="text-[9px] font-black text-slate-400">#{item.skuId}</span>
                            </div>
                            <div className="flex flex-col items-end">
                              {(() => {
                                const sku = skus.find(s => s.id === item.skuId);
                                const perCarton = item.pcsPerCarton || sku?.pcsPerCarton || 1;
                                if (perCarton <= 1 || item.inputMode === 'PCS') {
                                  return <span className="text-emerald-600 font-black">+{item.quantity} PCS (Eceran)</span>;
                                }
                                const dus = Math.floor(item.quantity / perCarton);
                                const sisa = item.quantity % perCarton;
                                return (
                                  <>
                                    <span className="text-emerald-600 font-black">+{dus} DUS {sisa > 0 ? `+ ${sisa} PCS` : ''}</span>
                                    <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter">Total: {item.quantity} PCS</span>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        ))}
                     </div>
                   </div>
                 ))}
               </div>
            ) : (
              <div className="p-6">
                <table className="w-full text-left">
                  <thead className="text-slate-400 text-[9px] uppercase font-black tracking-widest border-b border-slate-100">
                    <tr><th className="px-3 py-3">Nama Barang</th><th className="px-3 py-3 text-center">Frek</th><th className="px-3 py-3 text-right">Masuk</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {summaryData.map(item => (
                      <tr key={item.skuId} className="hover:bg-slate-50 group">
                        <td className="px-3 py-4">
                          <div className="flex flex-col">
                            <span className="text-[11px] font-black text-slate-900 uppercase">{item.skuName}</span>
                            <span className="text-[9px] font-black text-slate-400">#{item.skuId}</span>
                          </div>
                        </td>
                        <td className="px-3 py-4 text-center"><span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[9px] font-black">{item.transactions} Trans</span></td>
                        <td className="px-3 py-4 text-right"><span className="text-emerald-600 font-black text-[15px]">+{item.totalQty}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showFilters && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowFilters(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-lg bg-white rounded-[2.5rem] p-8 shadow-2xl">
               <h3 className="text-xl font-black text-slate-900 mb-6">Filter Data Masuk</h3>
               <div className="space-y-4">
                 <input type="date" value={filters.date} onChange={(e) => setFilters(prev => ({ ...prev, date: e.target.value }))} className="w-full bg-slate-50 border border-slate-200 rounded-2xl px-6 py-4" />
                 <input type="text" value={filters.receiptId} onChange={(e) => setFilters(prev => ({ ...prev, receiptId: e.target.value }))} placeholder="Cari nomor dokumen..." className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5" />
               </div>
               <button onClick={() => setShowFilters(false)} className="w-full mt-8 bg-indigo-600 text-white font-black py-4 rounded-2xl shadow-xl">Terapkan Filter</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DataMasuk;
