import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { processTransaction, deleteTransaction } from '../services/rekapService';
import { SKU } from '../types';
import { Trash2, ExternalLink, AlertCircle, Filter, X, ChevronDown, Search } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const DataKeluar: React.FC = () => {
  const { activeWarehouse } = useWarehouse();
  const [skus, setSkus] = useState<SKU[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [quantity, setQuantity] = useState(0);
  const [inputMode, setInputMode] = useState<'PCS' | 'CARTON'>('PCS');
  const [numCartons, setNumCartons] = useState(0);
  const [pcsPerCartonOverride, setPcsPerCartonOverride] = useState(1);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [logs, setLogs] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState({
    date: '',
    skuId: '',
    receiptId: '',
    reason: '',
  });

  // Unique values for filters
  const uniqueItems = Array.from(new Set(logs.map(l => l.skuId))).filter(Boolean).sort();
  const uniqueReasons = Array.from(new Set(logs.map(l => l.reason))).filter(Boolean).sort();

  const filteredLogs = logs.filter(log => {
    const logDate = log.date || '';

    const matchesDate = !filters.date || logDate === filters.date;
    const matchesSku = !filters.skuId || log.skuId === filters.skuId;
    const matchesRef = !filters.receiptId || log.receiptId?.toLowerCase().includes(filters.receiptId.toLowerCase());
    const matchesReason = !filters.reason || log.reason === filters.reason;

    return matchesDate && matchesSku && matchesRef && matchesReason;
  });

  useEffect(() => {
    if (!activeWarehouse) return;

    const unsubSkus = onSnapshot(query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id)), (snap) => {
      setSkus(snap.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id.split('_').slice(1).join('_') } as SKU;
      }));
    }, (error) => {
      console.error("Error fetching skus in DataKeluar:", error);
      handleFirestoreError(error, OperationType.LIST, 'skus');
    });

    const q = query(
      collection(db, 'history/keluar/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('createdAt', 'desc'),
      limit(200)
    );
    const unsubLogs = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)).filter(log => log.type === 'KELUAR'));
    }, (error) => {
      console.error("Error fetching logs in DataKeluar:", error);
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
      await deleteTransaction('KELUAR', id);
    } catch (err) {
      console.error(err);
      const msg = 'Gagal menghapus data keluar.';
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
    if (!reason) {
      window.alert('Keterangan wajib diisi (alasan keluar)!');
      return setError('Keterangan wajib diisi (alasan keluar)!');
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
      await processTransaction('KELUAR', {
        skuId: selectedSku,
        quantity,
        receiptId: documentNo,
        reason,
        date,
        warehouseId: activeWarehouse.id,
        ...(inputMode === 'CARTON' ? { pcsPerCarton: pcsPerCartonOverride } : {})
      });
      setDocumentNo('');
      setQuantity(0);
      setNumCartons(0);
      setReason('');
    } catch (err) {
      const msg = 'Gagal memproses data keluar.';
      setError(msg);
      window.alert(msg);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
      {/* Operations Panel */}
      <div className="xl:col-span-4 space-y-6 sticky top-24">
        <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl shadow-slate-200/40 p-8">
          <div className="flex items-center gap-4 mb-8">
            <div className="bg-orange-500/10 p-3 rounded-2xl">
              <ExternalLink className="w-8 h-8 text-orange-600" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900 tracking-tight">Stock OUT</h2>
              <p className="text-sm font-medium text-slate-400">Pengurangan stok khusus</p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Tanggal</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-100 focus:border-orange-400 focus:bg-white outline-none transition-all font-bold text-slate-700 text-sm"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Ref/No. Nota</label>
                  <input
                    type="text"
                    value={documentNo}
                    onChange={(e) => setDocumentNo(e.target.value)}
                    placeholder="Opsional"
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-100 focus:border-orange-400 focus:bg-white outline-none transition-all font-bold text-slate-700 text-sm placeholder:font-normal"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Inventory SKU</label>
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
                    className="w-full px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-100 focus:border-orange-400 focus:bg-white outline-none transition-all font-bold text-slate-700 appearance-none"
                  >
                    <option value="">-- PILIH BARANG --</option>
                    {skus.map(sku => (
                      <option key={sku.id} value={sku.id}>{sku.id} &bull; {sku.name} (Isi: {sku.pcsPerCarton || 1})</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-300">
                    <ExternalLink className="w-4 h-4" />
                  </div>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <div className="flex bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setInputMode('PCS')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${inputMode === 'PCS' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-400'}`}
                  >
                    Pcs (Eceran)
                  </button>
                  <button
                    type="button"
                    onClick={() => setInputMode('CARTON')}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${inputMode === 'CARTON' ? 'bg-white text-orange-600 shadow-sm' : 'text-slate-400'}`}
                  >
                    Input Dus (Box)
                  </button>
                </div>

                {inputMode === 'PCS' ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-5 gap-2 items-end">
                      <div className="col-span-3 space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 block">Unit Pengurangan (PCS)</label>
                        <input
                          type="number"
                          value={quantity || ''}
                          onChange={(e) => setQuantity(Number(e.target.value))}
                          placeholder="0"
                          className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-100 focus:border-orange-400 focus:bg-white outline-none transition-all font-black text-2xl text-orange-600 placeholder:text-slate-300 text-center"
                          min="1"
                        />
                      </div>
                      <div className="col-span-2 space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1 block">Dari Isi Dus</label>
                        <select
                          value={pcsPerCartonOverride}
                          onChange={(e) => setPcsPerCartonOverride(Number(e.target.value))}
                          className="w-full px-2 py-4 bg-slate-100 border border-slate-200 rounded-xl focus:border-orange-400 outline-none transition-all font-black text-sm text-slate-600 text-center appearance-none cursor-pointer"
                        >
                           {(() => {
                            const sku = skus.find(s => s.id === selectedSku);
                            if (!sku) return <option value="0">SKU?</option>;
                            
                            const sizes = Array.from(new Set([
                              sku.pcsPerCarton, 
                              ...(sku.cartonSizes || []), 
                              ...Object.keys(sku.detailedStock || {}).map(Number)
                            ]))
                            .filter(s => s && s > 0)
                            .sort((a, b) => a - b);
                            
                            return sizes.map(size => {
                              const stockObj = sku.detailedStock?.[String(size)];
                              const totalInPool = typeof stockObj === 'object' ? stockObj.total : (stockObj || 0);
                              return (
                                <option key={size} value={size}>
                                  ISI {size} ({totalInPool} Pcs)
                                </option>
                              );
                            });
                          })()}
                        </select>
                      </div>
                    </div>
                    <div className="flex justify-center -mt-2">
                       <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest border-t border-slate-50 pt-2 px-4 italic text-center">
                         * Akan dikurangi dari pool isi {pcsPerCartonOverride} terlebih dahulu
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
                        className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:border-orange-500 focus:bg-white transition-all font-black text-2xl text-orange-600 text-center"
                      />
                    </div>
                    <div className="space-y-2 text-center">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Isi Dus (POOL)</label>
                      <select
                        value={pcsPerCartonOverride || ''}
                        onChange={(e) => {
                          const val = Number(e.target.value);
                          setPcsPerCartonOverride(val);
                          setQuantity(numCartons * val);
                        }}
                        className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-xl focus:border-orange-500 focus:bg-white transition-all font-black text-xl text-orange-600 text-center appearance-none shadow-sm cursor-pointer"
                      >
                        {(() => {
                          const sku = skus.find(s => s.id === selectedSku);
                          if (!sku) return <option value="0">PILIH SKU</option>;
                          
                          const sizes = Array.from(new Set([
                            sku.pcsPerCarton, 
                            ...(sku.cartonSizes || []), 
                            ...Object.keys(sku.detailedStock || {}).map(Number)
                          ]))
                          .filter(s => s && s > 0)
                          .sort((a, b) => a - b);
                          
                          if (sizes.length === 0) return <option value={sku.pcsPerCarton || 1}>ISI {sku.pcsPerCarton || 1}</option>;
                          
                          return sizes.map(size => {
                            const stockObj = sku.detailedStock?.[String(size)];
                            const totalInPool = typeof stockObj === 'object' ? stockObj.total : (stockObj || 0);
                            const boxesInPool = Math.floor(totalInPool / size);
                            return (
                              <option key={size} value={size}>
                                ISI {size} &nbsp; ({boxesInPool} Dus Ready)
                              </option>
                            );
                          });
                        })()}
                      </select>
                    </div>
                    {numCartons > 0 && (
                      <div className="col-span-2 text-center -mt-1">
                        <span className="text-[11px] font-black text-orange-600/50 uppercase tracking-[0.2em] italic">
                          Total: {quantity} PCS
                        </span>
                      </div>
                    )}
                  </div>
                )}
                
                {selectedSku && quantity > 0 && inputMode === 'PCS' && (
                  <div className="hidden">
                    {/* Handled automatically */}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between ml-1">
                  <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Alasan Pengeluaran</label>
                  <div className="flex gap-1.5 font-bold">
                    {['Rusak', 'Sample', 'Giveaway'].map(tag => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setReason(prev => prev ? `${prev}, ${tag}` : tag)}
                        className="px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[9px] text-slate-400 hover:border-orange-500 hover:text-orange-600 transition-all hover:bg-white"
                      >
                        + {tag}
                      </button>
                    ))}
                  </div>
                </div>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Sebutkan alasan: Rusak, Sample, Giveaway, dll..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-4 focus:ring-orange-100 focus:border-orange-400 focus:bg-white outline-none transition-all font-bold text-slate-700 text-sm h-24 resize-none placeholder:font-normal placeholder:text-slate-300"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isProcessing}
              className="w-full bg-orange-600 hover:bg-orange-700 text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-orange-200 active:scale-[0.98] disabled:opacity-50 disabled:grayscale flex items-center justify-center gap-2 uppercase tracking-widest text-sm"
            >
              {isProcessing ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : 'Submit Pengeluaran'}
            </button>
          </form>

          {error && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-6 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span className="text-xs font-bold leading-tight">{error}</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* Activity Stream */}
      <div className="xl:col-span-8 flex flex-col min-h-[600px]">
        <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/30 overflow-hidden flex flex-col h-full">
          <div className="p-8 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-500 uppercase tracking-widest">Special Withdrawal Audit</h3>
            
            <div className="flex items-center gap-4">
              {Object.values(filters).some(v => v !== '') && (
                <button 
                  onClick={() => setFilters({ date: '', skuId: '', receiptId: '', reason: '' })}
                  className="text-[10px] font-black text-rose-500 uppercase tracking-widest hover:underline"
                >
                  Reset
                </button>
              )}
              <button 
                onClick={() => setShowFilters(true)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                  Object.values(filters).some(v => v !== '') 
                  ? 'bg-orange-600 text-white shadow-lg shadow-orange-200' 
                  : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Filter className="w-3 h-3" />
                Filter {Object.values(filters).filter(v => v !== '').length > 0 && `(${Object.values(filters).filter(v => v !== '').length})`}
              </button>
              <div className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest leading-none">
                Audited
              </div>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-slate-50/50 text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100">
                  <th className="px-8 py-5">Date</th>
                  <th className="px-6 py-5">Inventory Details</th>
                  <th className="px-6 py-5">Reason & Evidence</th>
                  <th className="px-6 py-5 text-center">Carton/Dus</th>
                  <th className="px-8 py-5 text-right w-20">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                <AnimatePresence mode="popLayout" initial={false}>
                  {filteredLogs.length === 0 ? (
                    <tr>
                       <td colSpan={5} className="py-32 text-center">
                          <div className="flex flex-col items-center justify-center">
                             <ExternalLink className="w-16 h-16 mb-4 text-slate-100" />
                             <p className="font-bold text-slate-400 uppercase tracking-widest text-xs">Data Tidak Ditemukan</p>
                             {Object.values(filters).some(v => v !== '') && (
                                <button 
                                  onClick={() => setFilters({ date: '', skuId: '', receiptId: '', reason: '' })}
                                  className="mt-4 text-orange-600 font-bold hover:underline text-[10px] uppercase tracking-widest"
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
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      className="group hover:bg-slate-50/30 transition-all duration-200"
                    >
                      <td className="px-8 py-6 whitespace-nowrap">
                        <span className="text-xs font-black text-slate-900 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200/50 shadow-sm">{log.date}</span>
                      </td>
                      <td className="px-6 py-6">
                         <div className="flex flex-col">
                           <span className="text-sm font-black text-slate-900 group-hover:text-orange-600 transition-colors uppercase mb-1 leading-none">{log.skuName}</span>
                           <span className="text-[10px] font-black font-mono text-slate-400 tracking-widest leading-none">{log.skuId}</span>
                         </div>
                      </td>
                      <td className="px-6 py-6 max-w-xs">
                         <div className="flex flex-col gap-1">
                           <span className="text-xs font-bold text-orange-800 italic leading-relaxed">"{log.reason}"</span>
                           <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Ref: {log.receiptId || "NO-REF"}</span>
                         </div>
                      </td>
                      <td className="px-6 py-6 text-center">
                        <div className="flex flex-col items-center justify-center">
                           {(() => {
                              const sku = skus.find(s => s.id === log.skuId);
                              const perCarton = log.pcsPerCarton || sku?.pcsPerCarton || 1;

                              if (log.inputMode === 'PCS') {
                                return (
                                  <div className="flex flex-col items-center">
                                    <div className="bg-orange-50 text-orange-600 px-4 py-2 rounded-2xl font-black text-xl border border-orange-100 shadow-sm flex items-center tabular-nums">
                                       <span className="text-[12px] mr-1 font-bold">-</span>
                                       {log.quantity} <span className="text-[10px] ml-1 opacity-60">PCS</span>
                                    </div>
                                    <div className="flex flex-col items-center mt-1">
                                      <span className="text-[8px] font-black bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full border border-orange-200 uppercase tracking-tighter">
                                        Eceran
                                      </span>
                                      <span className="text-[8px] font-bold text-slate-300 uppercase tracking-tighter mt-1">
                                        (Dari Isian {perCarton} - Stok Terendah)
                                      </span>
                                    </div>
                                  </div>
                                );
                              }

                              const dus = Math.floor(log.quantity / perCarton);
                              const sisa = log.quantity % perCarton;
                              return (
                                <>
                                  <div className="bg-orange-50 text-orange-600 px-3 py-2 rounded-2xl font-black text-xl border border-orange-100 shadow-sm flex items-center gap-1">
                                     <span className="text-xs">-</span>
                                     {dus} <span className="text-[10px] ml-0.5 opacity-60">DUS</span>
                                  </div>
                                  <div className="flex flex-col items-center mt-1">
                                    {sisa > 0 && (
                                      <span className="text-[9px] font-black text-orange-500 uppercase tracking-widest leading-none">
                                        - {sisa} PCS
                                      </span>
                                    )}
                                    <span className="text-[8px] font-bold text-slate-400 uppercase tracking-tighter mt-0.5">
                                      Total: {log.quantity} PCS
                                      {log.pcsPerCarton && log.pcsPerCarton !== sku?.pcsPerCarton && ` (Isi ${log.pcsPerCarton})`}
                                    </span>
                                  </div>
                                </>
                              );
                           })()}
                        </div>
                      </td>
                      <td className="px-8 py-6 text-right">
                          {confirmDeleteId === log.id ? (
                            <motion.div 
                              initial={{ opacity: 0, scale: 0.8 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className="flex items-center justify-end gap-1"
                            >
                              <button
                                onClick={() => handleDelete(log.id)}
                                className="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg shadow-lg"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="w-8 h-8 flex items-center justify-center bg-slate-200 text-slate-600 rounded-lg"
                              >
                                <span className="text-[10px] font-black uppercase">X</span>
                              </button>
                            </motion.div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteId(log.id)}
                              disabled={isDeleting === log.id}
                              className="w-10 h-10 flex items-center justify-center text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all opacity-0 group-hover:opacity-100 disabled:opacity-20"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
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
                        <div className="bg-orange-100 p-2 rounded-xl text-orange-600">
                           <Filter className="w-5 h-5" />
                        </div>
                        <div>
                           <h3 className="text-xl font-black text-slate-900">Filter Data Keluar</h3>
                           <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Pencarian Spesifik</p>
                        </div>
                     </div>
                     <button 
                       onClick={() => setFilters({ date: '', skuId: '', receiptId: '', reason: '' })}
                       className="text-[10px] font-black text-orange-600 uppercase tracking-widest hover:underline"
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
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-bold focus:border-orange-400 outline-none cursor-pointer"
                        />
                     </div>

                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Inventory Item</label>
                        <select 
                           value={filters.skuId}
                           onChange={(e) => setFilters(prev => ({ ...prev, skuId: e.target.value }))}
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-orange-400 outline-none appearance-none cursor-pointer"
                        >
                           <option value="">Semua Item</option>
                           {uniqueItems.map(id => (
                              <option key={id} value={id}>{id} | {logs.find(l => l.skuId === id)?.skuName || id}</option>
                           ))}
                        </select>
                     </div>

                     <div className="space-y-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Reason / Alasan</label>
                        <select 
                           value={filters.reason}
                           onChange={(e) => setFilters(prev => ({ ...prev, reason: e.target.value }))}
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-orange-400 outline-none appearance-none cursor-pointer"
                        >
                           <option value="">Semua Alasan</option>
                           {uniqueReasons.map(r => (
                              <option key={r} value={r}>{r}</option>
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
                           className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-orange-400 outline-none"
                        />
                     </div>
                  </div>

                  <button 
                    onClick={() => setShowFilters(false)}
                    className="w-full mt-8 bg-orange-600 text-white font-black py-4 rounded-2xl shadow-xl shadow-orange-100 hover:bg-slate-900 transition-all uppercase tracking-widest text-[10px]"
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

export default DataKeluar;
