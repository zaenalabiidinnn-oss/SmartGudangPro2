import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { processTransaction, deleteTransaction, inspectRetur, releaseFromHold, disposeBrokenStock, releaseFromBroken, importReturLogs, bulkUpdateSpecialStock } from '../services/rekapService';
import { SKU } from '../types';
import { Trash2, RotateCcw, AlertCircle, PackageCheck, PauseCircle, XCircle, Wrench, CheckCircle2, History, X, Download, Upload, FileSpreadsheet } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import * as XLSX from 'xlsx';

interface LogEntry {
  id: string;
  skuId: string;
  skuName: string;
  quantity: number;
  receiptId: string;
  date: string;
  createdAt: any;
  type?: string;
  pcsPerCarton?: number;
  inputMode?: 'PCS' | 'CARTON';
  reason?: string;
}

const DataRetur: React.FC = () => {
  const { activeWarehouse } = useWarehouse();
  const [skus, setSkus] = useState<SKU[]>([]);
  const [selectedSku, setSelectedSku] = useState('');
  const [documentNo, setDocumentNo] = useState('');
  const [returType, setReturType] = useState<'RETUR' | 'CANCEL'>('RETUR');
  const [reason, setReason] = useState('');
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
  const [skuAction, setSkuAction] = useState<{sku: SKU, type: 'HOLD' | 'RUSAK'} | null>(null);
  const [actionQuantity, setActionQuantity] = useState<number>(0);
  const [selectedPcsPerCarton, setSelectedPcsPerCarton] = useState<number>(0);
  const [activeSubTab, setActiveSubTab] = useState<'INPUT' | 'INSPEKSI' | 'HOLD' | 'RUSAK'>('INPUT');
  const [viewMode, setViewMode] = useState<'LOG' | 'SUMMARY'>('LOG');

  // Inspection states
  const [inspectingItem, setInspectingItem] = useState<LogEntry | null>(null);
  const [inspectQuantity, setInspectQuantity] = useState<number>(0);
  const [inspectionStep, setInspectionStep] = useState<'QUANTITY' | 'CONDITION' | 'REPAIR' | 'TARGET'>('QUANTITY');
  const [selectedCondition, setSelectedCondition] = useState<'BAGUS' | 'RUSAK' | null>(null);
  const [isRepairable, setIsRepairable] = useState<boolean | null>(null);

  const handleExport = () => {
    let dataToExport: any[] = [];
    let filename = '';

    if (activeSubTab === 'INSPEKSI') {
      if (viewMode === 'LOG') {
        dataToExport = logs.map(l => ({
          'Tanggal': l.date,
          'SKU ID': l.skuId,
          'Nama Barang': l.skuName,
          'Ref Dokumen': l.receiptId,
          'Alasan': l.reason,
          'Jumlah (PCS)': l.quantity
        }));
        filename = `Riwayat_Retur_${activeWarehouse?.name || 'Gudang'}_${new Date().toISOString().split('T')[0]}.xlsx`;
      } else {
        dataToExport = summaryData.map(s => ({
          'SKU ID': s.skuId,
          'Nama Barang': s.skuName,
          'Jumlah Pending Cek (PCS)': s.totalQty,
          'Frekuensi': s.count
        }));
        filename = `Pending_Inspeksi_${activeWarehouse?.name || 'Gudang'}_${new Date().toISOString().split('T')[0]}.xlsx`;
      }
    } else if (activeSubTab === 'HOLD') {
      dataToExport = skus
        .filter(s => (s.holdStock || 0) > 0)
        .map(s => ({
          'SKU ID': s.id,
          'Nama Barang': s.name,
          'Stok Hold (PCS)': s.holdStock
        }));
      filename = `Stok_Hold_${activeWarehouse?.name || 'Gudang'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    } else if (activeSubTab === 'RUSAK') {
      dataToExport = skus
        .filter(s => (s.brokenStock || 0) > 0)
        .map(s => ({
          'SKU ID': s.id,
          'Nama Barang': s.name,
          'Stok Rusak (PCS)': s.brokenStock
        }));
      filename = `Stok_Rusak_${activeWarehouse?.name || 'Gudang'}_${new Date().toISOString().split('T')[0]}.xlsx`;
    }

    if (dataToExport.length === 0) {
      setError('Tidak ada data untuk diekspor');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(dataToExport);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    XLSX.writeFile(wb, filename);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWarehouse) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        setIsProcessing(true);
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json(ws) as any[];

        if (activeSubTab === 'INSPEKSI') {
          const records = data.map(row => ({
            skuId: String(row['SKU ID'] || row['skuId'] || ''),
            quantity: Number(row['Jumlah (PCS)'] || row['quantity'] || 0),
            receiptId: String(row['Ref Dokumen'] || row['receiptId'] || 'IMPORT'),
            date: String(row['Tanggal'] || row['date'] || new Date().toISOString().split('T')[0]),
            reason: String(row['Alasan'] || row['reason'] || 'Import Massal')
          })).filter(r => r.skuId && r.quantity > 0);

          if (records.length === 0) throw new Error('Data tidak valid atau kosong');
          await importReturLogs(activeWarehouse.id, records);
        } else {
          const type = activeSubTab as 'HOLD' | 'RUSAK';
          const qtyField = type === 'HOLD' ? 'Stok Hold (PCS)' : 'Stok Rusak (PCS)';
          const records = data.map(row => ({
            skuId: String(row['SKU ID'] || row['skuId'] || ''),
            quantity: Number(row[qtyField] || row['quantity'] || 0)
          })).filter(r => r.skuId && r.quantity >= 0);

          if (records.length === 0) throw new Error('Data tidak valid atau kosong');
          await bulkUpdateSpecialStock(activeWarehouse.id, type, records);
        }
        
        setError('');
        // Alert success? Use a small state or just let the lists update
      } catch (err) {
        console.error(err);
        setError(`Gagal impor: ${err instanceof Error ? err.message : 'Format file salah'}`);
      } finally {
        setIsProcessing(false);
        e.target.value = ''; // Reset input
      }
    };
    reader.readAsBinaryString(file);
  };

  useEffect(() => {
    if (!activeWarehouse) return;

    const unsubSkus = onSnapshot(query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id)), (snap) => {
      setSkus(snap.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id.split('_').slice(1).join('_') } as SKU;
      }));
    }, (error) => {
      console.error("Error fetching skus in DataRetur:", error);
      handleFirestoreError(error, OperationType.LIST, 'skus');
    });

    const q = query(
      collection(db, 'history/retur/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const unsubLogs = onSnapshot(q, (snap) => {
      setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LogEntry)));
    }, (error) => {
      console.error("Error fetching logs in DataRetur:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/retur/records');
    });

    return () => {
      unsubSkus();
      unsubLogs();
    };
  }, [activeWarehouse]);

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setConfirmDeleteId(null);
    setIsDeleting(id);
    try {
      await deleteTransaction('RETUR', id);
    } catch (err) {
      console.error(err);
      setError('Gagal menghapus data retur.');
    } finally {
      setIsDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedSku) return setError('Pilih SKU!');
    if (!documentNo) return setError('Isi nomor dokumen!');
    if (returType === 'CANCEL' && !reason) return setError('Alasan wajib diisi untuk transaksi CANCEL!');
    if (quantity <= 0) return setError('Jumlah harus lebih dari 0!');
    if (!activeWarehouse) return setError('Pilih gudang terlebih dahulu!');

    setIsProcessing(true);
    try {
      await processTransaction('RETUR', {
        skuId: selectedSku,
        quantity,
        receiptId: documentNo,
        reason: reason ? `[${returType}] ${reason}` : `[${returType}] Tanpa Alasan`,
        date,
        warehouseId: activeWarehouse.id,
        ...(inputMode === 'CARTON' ? { pcsPerCarton: pcsPerCartonOverride } : {})
      });
      setDocumentNo('');
      setReason('');
      setReturType('RETUR');
      setQuantity(0);
      setNumCartons(0);
      setActiveSubTab('INSPEKSI'); // Auto switch to view the record
      setViewMode('LOG');
    } catch (err) {
      setError('Gagal memproses data retur.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePerformInspection = async (target: 'JUAL' | 'HOLD' | 'RUSAK') => {
    if (!inspectingItem || !activeWarehouse) return;
    setIsProcessing(true);
    try {
      await inspectRetur({
        skuId: inspectingItem.skuId,
        quantity: inspectQuantity,
        target,
        warehouseId: activeWarehouse.id,
        condition: selectedCondition!,
        repairable: isRepairable ?? undefined,
        pcsPerCarton: inspectingItem.pcsPerCarton
      });
      setInspectingItem(null);
      setInspectionStep('QUANTITY');
      setSelectedCondition(null);
      setIsRepairable(null);
      setInspectQuantity(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal memproses inspeksi.';
      // Check if it's our JSON error format
      try {
        const parsed = JSON.parse(msg);
        setError(`Error: ${parsed.error || 'Firestore Error'}`);
      } catch {
        setError(msg);
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const summaryBySku = logs.reduce((acc, log) => {
    const key = log.skuId;
    if (!acc[key]) {
      acc[key] = { 
        skuId: log.skuId, 
        skuName: log.skuName, 
        totalQty: 0, 
        count: 0,
        logIds: [] as string[]
      };
    }
    acc[key].totalQty += log.quantity;
    acc[key].count += 1;
    acc[key].logIds.push(log.id);
    return acc;
  }, {} as Record<string, { skuId: string; skuName: string; totalQty: number; count: number; logIds: string[] }>);

  const summaryData = (Object.values(summaryBySku) as { skuId: string; skuName: string; totalQty: number; count: number; logIds: string[] }[])
    .sort((a, b) => b.totalQty - a.totalQty);

  return (
    <div className="space-y-8">
      {/* Sub Menu Navigation */}
      <div className="flex flex-wrap items-center justify-between bg-white p-2 rounded-2xl border border-slate-200 shadow-sm gap-2">
        <div className="flex flex-wrap gap-2">
          {[
            { id: 'INPUT', label: 'Input Retur', icon: AlertCircle },
            { id: 'INSPEKSI', label: 'Inspeksi Produk', icon: PackageCheck },
            { id: 'HOLD', label: 'Stok Hold', icon: PauseCircle },
            { id: 'RUSAK', label: 'Stok Rusak', icon: XCircle },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-2 px-6 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                activeSubTab === tab.id 
                  ? 'bg-rose-500 text-white shadow-lg shadow-rose-100' 
                  : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 pr-2">
           {['INSPEKSI', 'HOLD', 'RUSAK'].includes(activeSubTab) && (
             <>
               <button
                 onClick={handleExport}
                 className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-all border border-emerald-100"
                 title="Export Data ke Excel"
               >
                 <Download className="w-3.5 h-3.5" />
                 Export
               </button>
               <label className="flex items-center gap-2 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-indigo-100 transition-all border border-indigo-100 cursor-pointer shadow-sm">
                 <Upload className="w-3.5 h-3.5" />
                 Import
                 <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} disabled={isProcessing} />
               </label>
             </>
           )}
           <div className="px-6 hidden xl:block">
              <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em]">Retur Management System</span>
           </div>
        </div>
      </div>

      {error && (
        <motion.div 
          initial={{ opacity: 0, y: -10 }} 
          animate={{ opacity: 1, y: 0 }} 
          className="bg-rose-50 border border-rose-100 p-4 rounded-xl flex items-center justify-between gap-3 shadow-sm"
        >
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600" />
            <p className="text-xs font-bold text-rose-600">{error}</p>
          </div>
          <button onClick={() => setError('')} className="p-1 hover:bg-rose-100 rounded-lg text-rose-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}

      <AnimatePresence mode="wait">
        {activeSubTab === 'INPUT' ? (
          <motion.div
            key="input-form"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="flex justify-center"
          >
            {/* Same input form as before */}
            <div className="w-full max-w-2xl">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 overflow-hidden">
                <div className="flex items-center gap-4 mb-8">
                  <div className="bg-rose-500 w-2 h-7 rounded-full" />
                  <div>
                    <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none italic uppercase">Input <span className="text-rose-500">RETUR</span></h2>
                    <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">Return Goods Entry</p>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                  {/* Error was here, moved up */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">
                        Tanggal Retur <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-rose-500 transition-all font-bold text-sm text-slate-700 shadow-sm"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">
                        Ref Nota / SJ <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={documentNo}
                        onChange={(e) => setDocumentNo(e.target.value)}
                        placeholder="NOMOR DOKUMEN"
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 focus:bg-rose-50/10 transition-all font-bold text-sm text-slate-700 shadow-sm placeholder:text-slate-200 outline-none"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">
                        Nama Barang <span className="text-rose-500">*</span>
                      </label>
                      <select
                        required
                        value={selectedSku}
                        onChange={(e) => {
                          const skuId = e.target.value;
                          setSelectedSku(skuId);
                          const sku = skus.find(s => s.id === skuId);
                          if (sku) setPcsPerCartonOverride(sku.pcsPerCarton || 1);
                        }}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-rose-500 transition-all font-black text-sm text-slate-700 appearance-none shadow-sm uppercase"
                      >
                        <option value="">-- PILIH ITEM --</option>
                        {skus.map(sku => (
                          <option key={sku.id} value={sku.id}>{sku.id} | {sku.name}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">
                        Jenis Transaksi <span className="text-rose-500">*</span>
                      </label>
                      <select
                        required
                        value={returType}
                        onChange={(e) => setReturType(e.target.value as 'RETUR' | 'CANCEL')}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-rose-500 transition-all font-black text-sm text-slate-700 appearance-none shadow-sm uppercase"
                      >
                        <option value="RETUR">RETUR</option>
                        <option value="CANCEL">CANCEL</option>
                      </select>
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 ml-1">
                        Kriteria / Alasan {returType} {returType === 'CANCEL' && <span className="text-rose-500">*</span>}
                      </label>
                      <textarea
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={returType === 'CANCEL' ? "WAJIB: Isi alasan pembatalan..." : "OPSIONAL: Isi alasan retur (jika ada)..."}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-0 focus:border-rose-500 transition-all font-black text-sm text-slate-700 shadow-sm min-h-[100px]"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-4 pt-2">
                      <div className="flex bg-slate-100 p-1 rounded-xl">
                        {['PCS', 'CARTON'].map(mode => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setInputMode(mode as any)}
                            className={`flex-1 py-3 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${inputMode === mode ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400'}`}
                          >
                            {mode === 'PCS' ? 'Pcs' : 'Isi Dus'}
                          </button>
                        ))}
                      </div>

                      {inputMode === 'PCS' ? (
                        <div className="space-y-2">
                          <label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-center block w-full">
                            QTY RETUR (PCS) <span className="text-rose-500">*</span>
                          </label>
                          <input
                            type="number"
                            required
                            min="1"
                            value={quantity || ''}
                            onChange={(e) => setQuantity(Number(e.target.value))}
                            placeholder="0"
                            className="w-full px-4 py-5 bg-slate-50/50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 focus:bg-white transition-all font-black text-4xl text-rose-600 placeholder:text-slate-100 text-center tabular-nums outline-none"
                          />
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2 text-center">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              Jml Dus <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              required
                              min="1"
                              value={numCartons || ''}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setNumCartons(val);
                                setQuantity(val * pcsPerCartonOverride);
                              }}
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-xl font-black text-2xl text-rose-600 text-center tabular-nums outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500"
                            />
                          </div>
                          <div className="space-y-2 text-center">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              PCS/Dus <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="number"
                              required
                              min="1"
                              value={pcsPerCartonOverride || ''}
                              onChange={(e) => {
                                const val = Number(e.target.value);
                                setPcsPerCartonOverride(val);
                                setQuantity(numCartons * val);
                              }}
                              className="w-full px-4 py-4 bg-slate-50 border border-slate-100 rounded-xl font-black text-2xl text-rose-600 text-center tabular-nums outline-none focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isProcessing}
                    className="w-full bg-slate-900 hover:bg-black text-white font-black py-5 rounded-xl transition-all shadow-xl active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2 uppercase tracking-[0.3em] text-[11px] mt-8"
                  >
                    {isProcessing ? 'Processing...' : 'SIMPAN DATA RETUR'}
                  </button>
                </form>
              </div>
            </div>
          </motion.div>
        ) : activeSubTab === 'INSPEKSI' ? (
          <motion.div
            key="inspeksi-view"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[600px] flex flex-col">
              <div className="px-8 py-5 bg-white border-b border-slate-50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                 <div className="flex bg-slate-100/50 p-1 rounded-xl border border-slate-100">
                    {['LOG', 'SUMMARY'].map(mode => (
                      <button 
                        key={mode}
                        onClick={() => setViewMode(mode as any)}
                        className={`px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] rounded-lg transition-all ${
                          viewMode === mode ? 'bg-white text-rose-600 shadow-sm' : 'text-slate-400 hover:text-slate-500'
                        }`}
                      >
                        {mode === 'LOG' ? 'Daftar Riwayat' : 'Stok Per Barang'}
                      </button>
                    ))}
                 </div>
                 <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-rose-500 rounded-full animate-pulse" />
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{viewMode === 'LOG' ? 'Realtime Update' : 'Persediaan Retur'}</span>
                 </div>
              </div>

              <div className="flex-1 overflow-x-auto">
                {viewMode === 'LOG' ? (
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-slate-50/50 text-slate-400 text-[9px] uppercase font-black tracking-widest">
                        <th className="px-8 py-4">Informasi Waktu</th>
                        <th className="px-8 py-4">Detail SKU</th>
                        <th className="px-8 py-4">Ref Nota / SJ</th>
                        <th className="px-8 py-4">Keterangan</th>
                        <th className="px-8 py-4 text-center">Jumlah Item</th>
                        <th className="px-8 py-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      <AnimatePresence mode="popLayout">
                        {logs.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-24 text-center">
                              <RotateCcw className="w-12 h-12 text-slate-100 mx-auto mb-4" />
                              <p className="text-xs font-black text-slate-300 uppercase tracking-widest">Belum ada data retur yang tercatat</p>
                            </td>
                          </tr>
                        ) : logs.map(log => (
                          <motion.tr key={log.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="group hover:bg-slate-50/50 transition-colors">
                            <td className="px-8 py-6">
                              <div className="flex flex-col">
                                <span className="text-[12px] font-black text-slate-900">{log.date}</span>
                                <span className="text-[10px] text-slate-400 font-bold tabular-nums">
                                  {log.createdAt?.toDate?.()?.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) || '...'}
                                </span>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="flex flex-col">
                                <span className="text-[12px] font-black text-slate-900 uppercase">
                                  {skus.find(s => s.id === log.skuId)?.name || log.skuName}
                                </span>
                                <span className="text-[10px] font-bold text-slate-300 font-mono tracking-tighter">#{log.skuId}</span>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <span className="text-[11px] font-black bg-rose-50 text-rose-700 px-2.5 py-1 rounded-lg border border-rose-100 uppercase tabular-nums">
                                {log.receiptId}
                              </span>
                            </td>
                            <td className="px-8 py-6">
                              <p className="text-[11px] text-slate-400 font-bold italic line-clamp-2 max-w-[200px]">{log.reason || 'Tanpa keterangan'}</p>
                            </td>
                            <td className="px-8 py-6 text-center">
                               <div className="flex flex-col items-center">
                                  <span className="text-[15px] font-black text-rose-600">+{log.quantity} <span className="text-[10px] opacity-60">PCS</span></span>
                               </div>
                            </td>
                             <td className="px-8 py-6">
                               <div className="flex items-center justify-end gap-3">
                                 {!(log as any).isAutoProcessed ? (
                                   <button
                                     onClick={() => {
                                       setInspectingItem(log);
                                       setInspectQuantity(log.quantity);
                                       setInspectionStep('CONDITION');
                                     }}
                                     className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-black hover:scale-105 active:scale-95 transition-all shadow-sm"
                                   >
                                     <PackageCheck className="w-3.5 h-3.5" />
                                     Cek Produk
                                   </button>
                                 ) : (
                                   <div className="flex items-center gap-2 px-3 py-2 bg-rose-50 text-rose-500 rounded-lg text-[9px] font-black uppercase tracking-[0.15em] border border-rose-100 italic">
                                     <XCircle className="w-3 h-3" />
                                     Auto Broken
                                   </div>
                                 )}
                                 <button 
                                  onClick={() => handleDelete(log.id)}
                                  disabled={isDeleting === log.id}
                                  className={`p-2.5 transition-all rounded-xl border flex items-center justify-center ${
                                    confirmDeleteId === log.id 
                                      ? 'bg-rose-600 text-white border-rose-500 shadow-lg shadow-rose-100 scale-110' 
                                      : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50 border-transparent hover:border-rose-100'
                                  }`}
                                  title={confirmDeleteId === log.id ? "Klik lagi untuk konfirmasi hapus" : "Hapus Log Retur"}
                                 >
                                    <Trash2 className="w-4 h-4" />
                                 </button>
                               </div>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                ) : (
                  <div className="p-8">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100">
                          <th className="px-6 py-4">Produk (Pending Cek)</th>
                          <th className="px-6 py-4 text-center">Frekuensi Retur</th>
                          <th className="px-6 py-4 text-right">Stok Per Barang (PCS)</th>
                          <th className="px-6 py-4"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {summaryData.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-24 text-center">
                              <RotateCcw className="w-12 h-12 text-slate-100 mx-auto mb-4" />
                              <p className="text-xs font-black text-slate-300 uppercase tracking-widest">Belum ada data akumulasi</p>
                            </td>
                          </tr>
                        ) : summaryData.map(item => (
                          <tr key={item.skuId} className="hover:bg-slate-50 transition-colors group">
                            <td className="px-6 py-5">
                              <div className="flex flex-col">
                                <span className="text-[13px] font-black text-slate-900 uppercase group-hover:text-rose-600 transition-colors">
                                  {skus.find(s => s.id === item.skuId)?.name || item.skuName}
                                </span>
                                <span className="text-[10px] font-bold text-slate-300 font-mono mt-0.5">#{item.skuId}</span>
                              </div>
                            </td>
                            <td className="px-6 py-5 text-center">
                               <span className="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest">{item.count} Kali</span>
                            </td>
                            <td className="px-6 py-5 text-right font-black text-rose-600 text-xl tabular-nums tracking-tighter">+{item.totalQty}</td>
                            <td className="px-6 py-5">
                               <div className="flex justify-end">
                                 <button
                                   onClick={() => {
                                     setInspectingItem(item as any);
                                     setInspectQuantity(item.totalQty);
                                     setInspectionStep('QUANTITY');
                                   }}
                                    className="flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-rose-600 hover:scale-105 active:scale-95 transition-all shadow-sm"
                                 >
                                   <PackageCheck className="w-3.5 h-3.5" />
                                   Cek Masal
                                 </button>
                               </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="summary-stocks"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden p-8"
          >
            <div className="flex items-center gap-4 mb-8">
              <div className={`${activeSubTab === 'HOLD' ? 'bg-amber-500' : 'bg-slate-900'} w-2 h-7 rounded-full`} />
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight leading-none italic uppercase">
                  STOK {activeSubTab === 'HOLD' ? <span className="text-amber-500">HOLD</span> : <span className="text-slate-500">RUSAK</span>}
                </h2>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mt-1">{activeSubTab === 'HOLD' ? 'Tahan Stok Sementara' : 'Barang Rusak / Tidak Layak Jual'}</p>
              </div>
            </div>

            <table className="w-full text-left">
              <thead>
                <tr className="text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100">
                  <th className="px-6 py-4">Nama Produk</th>
                  <th className="px-6 py-4 text-right">Jumlah Stok</th>
                  <th className="px-6 py-4 w-32 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {skus
                  .filter(sku => (activeSubTab === 'HOLD' ? sku.holdStock : sku.brokenStock))
                  .length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-24 text-center">
                      {activeSubTab === 'HOLD' ? <PauseCircle className="w-12 h-12 text-slate-100 mx-auto mb-4" /> : <XCircle className="w-12 h-12 text-slate-100 mx-auto mb-4" />}
                      <p className="text-xs font-black text-slate-300 uppercase tracking-widest">Belum ada data stok {activeSubTab}</p>
                    </td>
                  </tr>
                ) : skus
                    .filter(sku => (activeSubTab === 'HOLD' ? sku.holdStock : sku.brokenStock))
                    .map(sku => (
                  <tr key={sku.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-5">
                      <div className="flex flex-col">
                        <span className="text-[13px] font-black text-slate-900 uppercase">
                          {sku.name}
                        </span>
                        <span className="text-[10px] font-bold text-slate-300 font-mono mt-0.5">#{sku.id}</span>
                      </div>
                    </td>
                    <td className={`px-6 py-5 text-right font-black text-2xl tabular-nums tracking-tighter ${activeSubTab === 'HOLD' ? 'text-amber-500' : 'text-slate-700'}`}>
                      {activeSubTab === 'HOLD' ? (sku.holdStock || 0).toLocaleString() : (sku.brokenStock || 0).toLocaleString()} <span className="text-xs opacity-50 font-sans tracking-normal ml-1">PCS</span>
                    </td>
                    <td className="px-6 py-5 text-right">
                       <div className="flex justify-end gap-2">
                         {activeSubTab === 'RUSAK' && (
                           <button
                            disabled={isProcessing}
                            onClick={() => {
                              setSkuAction({ sku, type: 'RUSAK_RELEASE' as any });
                              setActionQuantity(sku.brokenStock || 0);
                              setSelectedPcsPerCarton(sku.pcsPerCarton || 1);
                            }}
                            className="w-10 h-10 flex items-center justify-center rounded-2xl transition-all text-emerald-500 hover:bg-emerald-50"
                            title="Rilis ke Jual"
                           >
                              <RotateCcw className="w-5 h-5" />
                           </button>
                         )}
                         <button
                            disabled={isProcessing}
                            onClick={() => {
                              setSkuAction({ sku, type: activeSubTab as 'HOLD' | 'RUSAK' });
                              setActionQuantity(activeSubTab === 'HOLD' ? sku.holdStock || 0 : sku.brokenStock || 0);
                              setSelectedPcsPerCarton(sku.pcsPerCarton || 1);
                            }}
                            className={`w-10 h-10 flex items-center justify-center rounded-2xl transition-all ${activeSubTab === 'HOLD' ? 'text-emerald-500 hover:bg-emerald-50' : 'text-slate-300 hover:text-rose-500 hover:bg-rose-50'}`}
                            title={activeSubTab === 'HOLD' ? "Rilis ke Jual" : "Pemusnahan"}
                         >
                            {activeSubTab === 'HOLD' ? <RotateCcw className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
                         </button>
                       </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Action Modal (Release/Dispose) */}
      <AnimatePresence>
        {skuAction && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setSkuAction(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white w-full max-w-[280px] rounded-[2rem] shadow-2xl overflow-hidden relative z-10 p-6"
            >
              <div className="text-center space-y-3 mb-6">
                <div className={`mx-auto w-12 h-12 rounded-2xl flex items-center justify-center ${skuAction.type === 'HOLD' || (skuAction.type as string) === 'RUSAK_RELEASE' ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                  {skuAction.type === 'HOLD' || (skuAction.type as string) === 'RUSAK_RELEASE' ? <RotateCcw className="w-5 h-5" /> : <Trash2 className="w-5 h-5" />}
                </div>
                <div>
                  <h3 className="text-sm font-black uppercase tracking-tight italic leading-none">
                    {skuAction.type === 'HOLD' ? 'Rilis Stok Hold' : (skuAction.type as string) === 'RUSAK_RELEASE' ? 'Rilis Stok Rusak' : 'Musnahkan Stok'}
                  </h3>
                  <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase line-clamp-1">{skuAction.sku.name}</p>
                </div>
              </div>

              <div className="space-y-5">
                 {/* PCS Per Carton Selection (Only if Releasing and multiple sizes exist) */}
                 {(skuAction.type === 'HOLD' || (skuAction.type as string) === 'RUSAK_RELEASE') && (
                   Object.keys(skuAction.sku.detailedStock || {}).length > 1 && (
                     <div className="space-y-1.5">
                       <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest block text-center">Pilih Isi Dus Tujuan</label>
                       <div className="flex flex-wrap justify-center gap-2">
                         {Object.keys(skuAction.sku.detailedStock || {}).sort((a, b) => Number(a) - Number(b)).map(size => (
                           <button
                             key={size}
                             onClick={() => setSelectedPcsPerCarton(Number(size))}
                             className={`px-3 py-2 rounded-xl text-[10px] font-black transition-all border ${
                               selectedPcsPerCarton === Number(size)
                                 ? 'bg-rose-500 text-white border-rose-500 shadow-sm'
                                 : 'bg-slate-50 text-slate-400 border-slate-100 hover:bg-slate-100'
                             }`}
                           >
                             Isi {size}
                           </button>
                         ))}
                       </div>
                     </div>
                   )
                 )}
                 <div className="space-y-1.5">
                    <div className="relative">
                      <input 
                        type="number"
                        autoFocus
                        value={actionQuantity || ''}
                        onChange={(e) => {
                          const max = skuAction.type === 'HOLD' ? skuAction.sku.holdStock || 0 : skuAction.sku.brokenStock || 0;
                          setActionQuantity(Math.min(Number(e.target.value), max));
                        }}
                        className="w-full px-3 py-4 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 transition-all font-black text-2xl text-slate-800 text-center tabular-nums outline-none"
                      />
                      <div className="absolute top-1.5 right-3 text-[8px] font-black text-slate-300 uppercase">QTY</div>
                    </div>
                    <p className="text-center text-[9px] font-black text-slate-300 uppercase">
                      Maksimal: {skuAction.type === 'HOLD' ? skuAction.sku.holdStock : skuAction.sku.brokenStock} PCS
                    </p>
                 </div>

                 <div className="flex gap-2">
                    <button 
                      onClick={() => setSkuAction(null)}
                      className="flex-1 py-3 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-slate-200 transition-all"
                    >
                      Batal
                    </button>
                    <button 
                      disabled={isProcessing || actionQuantity <= 0}
                      onClick={async () => {
                        if (!activeWarehouse) return;
                        setIsProcessing(true);
                        try {
                           if (skuAction.type === 'HOLD') {
                              await releaseFromHold({
                                skuId: skuAction.sku.id,
                                warehouseId: activeWarehouse.id,
                                quantity: actionQuantity,
                                pcsPerCarton: selectedPcsPerCarton
                              });
                           } else if ((skuAction.type as string) === 'RUSAK_RELEASE') {
                              await releaseFromBroken({
                                skuId: skuAction.sku.id,
                                warehouseId: activeWarehouse.id,
                                quantity: actionQuantity,
                                pcsPerCarton: selectedPcsPerCarton
                              });
                           } else {
                              await disposeBrokenStock({
                                skuId: skuAction.sku.id,
                                warehouseId: activeWarehouse.id,
                                quantity: actionQuantity
                              });
                           }
                           setSkuAction(null);
                        } catch (err) {
                           console.error(err);
                           setError('Gagal memproses aksi stok.');
                        } finally {
                           setIsProcessing(false);
                        }
                      }}
                      className={`flex-1 py-3 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg transition-all active:scale-95 disabled:opacity-50 ${skuAction.type === 'HOLD' || (skuAction.type as string) === 'RUSAK_RELEASE' ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-100' : 'bg-rose-600 hover:bg-rose-700 shadow-rose-100'}`}
                    >
                      {isProcessing ? '...' : 'OK'}
                    </button>
                 </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Inspection Modal */}
      <AnimatePresence>
        {inspectingItem && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }} 
              exit={{ opacity: 0 }} 
              onClick={() => setInspectingItem(null)}
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden relative z-10"
            >
              <div className="bg-slate-900 p-8 text-white">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.3em] text-slate-400">Pengecekan Barang</span>
                    <h3 className="text-2xl font-black italic uppercase tracking-tight mt-1">{inspectingItem.skuName}</h3>
                    <p className="text-xs font-bold text-slate-400 mt-1 uppercase tracking-widest">
                      {'receiptId' in inspectingItem ? (inspectingItem as any).receiptId : `Total Stok: ${(inspectingItem as any).totalQty} PCS`}
                    </p>
                  </div>
                  <PackageCheck className="w-12 h-12 text-rose-500 opacity-20" />
                </div>
              </div>

              <div className="p-8 space-y-8">
                {error && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.9 }} 
                    animate={{ opacity: 1, scale: 1 }} 
                    className="bg-rose-50 border border-rose-100 p-4 rounded-xl flex items-center gap-3"
                  >
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
                    <p className="text-[10px] font-bold text-rose-600 uppercase tracking-wide">{error}</p>
                  </motion.div>
                )}

                {inspectionStep === 'QUANTITY' && (
                  <div className="space-y-6">
                    <p className="text-center text-xs font-black uppercase tracking-[0.2em] text-slate-400">Pilih Jumlah yang akan dicek</p>
                    <div className="space-y-4">
                       <div className="relative">
                          <input
                            type="number"
                            value={inspectQuantity || ''}
                            onChange={(e) => setInspectQuantity(Math.min(Number(e.target.value), (inspectingItem as any).totalQty || (inspectingItem as any).quantity))}
                            className="w-full px-4 py-8 bg-slate-50 border border-slate-100 rounded-2xl focus:ring-4 focus:ring-rose-500/5 focus:border-rose-500 focus:bg-white transition-all font-black text-5xl text-rose-600 placeholder:text-slate-100 text-center tabular-nums outline-none"
                          />
                          <div className="absolute top-2 right-4 text-[10px] font-black text-slate-300 uppercase">Input Qty</div>
                       </div>
                       <div className="flex gap-2">
                          {[0.25, 0.5, 0.75, 1].map(ratio => {
                             const total = (inspectingItem as any).totalQty || (inspectingItem as any).quantity;
                             const val = Math.floor(total * ratio);
                             return (
                               <button 
                                 key={ratio}
                                 onClick={() => setInspectQuantity(val)}
                                 className="flex-1 py-3 bg-slate-50 text-slate-400 rounded-xl text-[10px] font-black uppercase hover:bg-slate-100 hover:text-slate-600 transition-all"
                               >
                                 {ratio * 100}% ({val})
                               </button>
                             )
                          })}
                       </div>
                       <button
                         onClick={() => setInspectionStep('CONDITION')}
                         disabled={inspectQuantity <= 0}
                         className="w-full bg-slate-900 text-white font-black py-4 rounded-xl text-[11px] uppercase tracking-widest shadow-xl active:scale-[0.98] transition-all disabled:opacity-50"
                       >
                         Lanjut Pengecekan
                       </button>
                    </div>
                  </div>
                )}

                {inspectionStep === 'CONDITION' && (
                  <div className="space-y-6">
                    <p className="text-center text-xs font-black uppercase tracking-[0.2em] text-slate-400">Bagaimana kondisi barang?</p>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => {
                          setSelectedCondition('BAGUS');
                          setInspectionStep('TARGET');
                        }}
                        disabled={isProcessing}
                        className="flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-100 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-600 hover:text-emerald-700 disabled:opacity-50"
                      >
                        <CheckCircle2 className="w-10 h-10" />
                        <span className="text-xs font-black uppercase tracking-widest">Bagus</span>
                      </button>
                      <button
                        onClick={() => {
                          setSelectedCondition('RUSAK');
                          setInspectionStep('REPAIR');
                        }}
                        disabled={isProcessing}
                        className="flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-100 hover:border-rose-500 hover:bg-rose-50 transition-all text-slate-600 hover:text-rose-700 disabled:opacity-50"
                      >
                        <XCircle className="w-10 h-10" />
                        <span className="text-xs font-black uppercase tracking-widest">Rusak</span>
                      </button>
                    </div>
                  </div>
                )}

                {inspectionStep === 'REPAIR' && (
                  <div className="space-y-6">
                    <p className="text-center text-xs font-black uppercase tracking-[0.2em] text-slate-400">Apakah barang bisa diperbaiki?</p>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => {
                          setIsRepairable(true);
                          setInspectionStep('TARGET');
                        }}
                        disabled={isProcessing}
                        className="flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-100 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-600 hover:text-emerald-700 disabled:opacity-50"
                      >
                        <Wrench className="w-10 h-10" />
                        <span className="text-xs font-black uppercase tracking-widest">Bisa Diperbaiki</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsRepairable(false);
                          handlePerformInspection('RUSAK');
                        }}
                        disabled={isProcessing}
                        className="flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-100 hover:border-slate-500 hover:bg-slate-50 transition-all text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        <XCircle className="w-10 h-10" />
                        <span className="text-xs font-black uppercase tracking-widest">Tidak Bisa</span>
                      </button>
                    </div>
                  </div>
                )}

                {inspectionStep === 'TARGET' && (
                  <div className="space-y-6">
                    <p className="text-center text-xs font-black uppercase tracking-[0.2em] text-slate-400">Pindahkan stok ke mana?</p>
                    <div className="grid grid-cols-2 gap-4">
                      <button
                        onClick={() => handlePerformInspection('JUAL')}
                        disabled={isProcessing}
                        className="flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-100 hover:border-emerald-500 hover:bg-emerald-50 transition-all text-slate-600 hover:text-emerald-700 disabled:opacity-50"
                      >
                        <RotateCcw className="w-10 h-10" />
                        <span className="text-xs font-black uppercase tracking-widest text-center">Stok Penjualan</span>
                      </button>
                      <button
                        onClick={() => handlePerformInspection('HOLD')}
                        disabled={isProcessing}
                        className="flex flex-col items-center gap-4 p-6 rounded-2xl border-2 border-slate-100 hover:border-amber-500 hover:bg-amber-50 transition-all text-slate-600 hover:text-amber-700 disabled:opacity-50"
                      >
                        <PauseCircle className="w-10 h-10" />
                        <span className="text-xs font-black uppercase tracking-widest text-center">Simpan (Hold)</span>
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setInspectingItem(null)}
                  className="w-full py-4 text-[10px] font-black uppercase tracking-[0.3em] text-slate-300 hover:text-slate-400 transition-colors"
                >
                  Batal / Tutup
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DataRetur;
