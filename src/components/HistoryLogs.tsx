import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, orderBy, limit, deleteDoc, doc, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { deleteTransaction } from '../services/rekapService';
import { Calendar, History, Trash2, Search, Filter, Download, AlertTriangle, Loader2, X, Plus, FileDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { utils, writeFile } from 'xlsx';

type ViewMode = 'ALL' | 'DAILY' | 'MONTHLY' | 'YEARLY';

interface HistoryLogsProps {
  role?: string | null;
}

const HistoryLogs: React.FC<HistoryLogsProps> = ({ role }) => {
  const { activeWarehouse } = useWarehouse();
  const isAdmin = role === 'ADMIN';
  const [viewMode, setViewMode] = useState<'LOGS'>('LOGS');
  const [filterDate, setFilterDate] = useState('');
  const [logs, setLogs] = useState<any[]>([]);
  const [skus, setSkus] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!activeWarehouse || viewMode !== 'SUMMARY') return;
    const q = query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id));
    const unsub = onSnapshot(q, (snap) => {
      setSkus(snap.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id.split('_').slice(1).join('_') };
      }));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'skus');
    });
    return unsub;
  }, [activeWarehouse, viewMode]);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<any[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    year: '',
    month: '',
    day: '',
    inventoryItem: '',
    reference: '',
    reason: '',
    type: ''
  });
  const [exportFields, setExportFields] = useState({
    timestamp: true,
    inventoryItem: true,
    reference: true,
    transactionType: true,
    alasan: true,
    masukPcs: true,
    masukDus: true,
    keluarPcs: true,
    keluarDus: true
  });

  const exportToExcel = () => {
    const itemsToExport = selectedLogs.length > 0 
      ? selectedLogs 
      : filteredLogs;

    if (itemsToExport.length === 0) {
      window.alert('Tidak ada data untuk diekspor!');
      return;
    }

    const dataToExport = itemsToExport.map(log => {
      const row: any = {};
      if (exportFields.timestamp) {
        row['Timestamp'] = log.date || (log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString('id-ID') : '-');
      }
      if (exportFields.inventoryItem) {
        row['Inventory Item'] = `${log.skuId} | ${log.skuName}`;
      }
      if (exportFields.reference) {
        row['Reference'] = log.receiptId || 'DIRECT';
      }
      if (exportFields.transactionType) {
        row['Transaction Type'] = log._source || log.type;
      }
      if (exportFields.alasan) {
        row['Alasan'] = log.reason || '-';
      }
      const isPositive = log._source === 'MASUK' || log._source === 'RETUR' || log.type === 'RESTOCK' || log.type === 'MASUK' || log.type === 'RETUR';
      const pcsPerCarton = log.pcsPerCarton || 0;
      
      if (exportFields.masukPcs) {
        row['Masuk (PCS)'] = isPositive ? log.quantity : 0;
      }
      if (exportFields.masukDus) {
        row['Masuk (DUS)'] = (isPositive && pcsPerCarton > 1) ? Math.floor(log.quantity / pcsPerCarton) : 0;
      }
      if (exportFields.keluarPcs) {
        row['Keluar (PCS)'] = !isPositive ? Math.abs(log.quantity) : 0;
      }
      if (exportFields.keluarDus) {
        row['Keluar (DUS)'] = (!isPositive && pcsPerCarton > 1) ? Math.floor(Math.abs(log.quantity) / pcsPerCarton) : 0;
      }
      return row;
    });

    const worksheet = utils.json_to_sheet(dataToExport);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Database Inventory');
    
    // Generate filename with current date
    const date = new Date().toISOString().split('T')[0];
    writeFile(workbook, `Rekap_Log_${date}.xlsx`);
    setShowExportModal(false);
  };

  // ... (exportToCSV use filteredLogs, which is fine)

  const exportToCSV = () => {
    if (filteredLogs.length === 0) {
      window.alert('Tidak ada data untuk diekspor.');
      return;
    }

    let headers = ['Waktu', 'SKU', 'Nama Barang', 'Ref/Resi', 'Tipe', 'Jumlah'];
    let rows = filteredLogs.map(log => [
      log.date || (log.createdAt?.toDate ? log.createdAt.toDate().toLocaleString('id-ID') : '-'),
      log.skuId,
      log.skuName,
      log.receiptId || '-',
      log._source || log.type,
      log.quantity
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `rekap_stok_all_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getLogType = (log: any) => {
    if (log._source === 'MASUK' || log.type === 'MASUK' || log.type === 'RESTOCK') return 'MASUK';
    if (log._source === 'RETUR' || log.type === 'RETUR') return 'RETUR';
    if (log._source === 'INSPEKSI' || log.type === 'INSPEKSI') return 'INSPEKSI';
    if (log._source === 'KELUAR') {
      if (log.type === 'SCAN KELUAR' || log.type === 'SALE') return 'SCAN';
      return 'KELUAR';
    }
    if (log.type === 'SCAN KELUAR' || log.type === 'SALE' || log.type === 'SCAN') return 'SCAN';
    return 'KELUAR';
  };

  const handleDelete = async (log: any) => {
    setConfirmDeleteId(null);
    setIsDeleting(log.id);
    try {
      const type = getLogType(log);
      await deleteTransaction(type, log.id);
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : 'Gagal menghapus log.';
      window.alert(`Error: ${msg}`);
    } finally {
      setIsDeleting(null);
    }
  };

  useEffect(() => {
    if (!activeWarehouse) return;
    setLoading(true);
    setSelectedLogs([]);
    
    // Fetch all collections and merge for ALL view
    let qMasuk = query(
      collection(db, 'history/masuk/records'), 
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('updatedAt', 'desc'), 
      limit(filterDate ? 500 : 200)
    );
    let qKeluar = query(
      collection(db, 'history/keluar/records'), 
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('updatedAt', 'desc'), 
      limit(filterDate ? 500 : 200)
    );
    let qRetur = query(
      collection(db, 'history/retur/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('updatedAt', 'desc'),
      limit(filterDate ? 500 : 100)
    );
    let qKoreksi = query(
      collection(db, 'history/koreksi/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('updatedAt', 'desc'),
      limit(filterDate ? 500 : 100)
    );
    let qInspeksi = query(
      collection(db, 'history/inspeksi/records'),
      where('warehouseId', '==', activeWarehouse.id),
      orderBy('updatedAt', 'desc'),
      limit(filterDate ? 500 : 100)
    );

    let masukLogs: any[] = [];
    let keluarLogs: any[] = [];
    let returLogs: any[] = [];
    let koreksiLogs: any[] = [];
    let inspeksiLogs: any[] = [];
    let unsubscribed = false;

    const updateAll = () => {
      if (unsubscribed) return;
      let combined = [...masukLogs, ...keluarLogs, ...returLogs, ...koreksiLogs, ...inspeksiLogs];
      
      if (filterDate) {
        combined = combined.filter(l => l.date === filterDate);
      }

      combined = combined.sort((a, b) => {
          const timeA = a.updatedAt?.toMillis?.() || 0;
          const timeB = b.updatedAt?.toMillis?.() || 0;
          return timeB - timeA;
        })
        .slice(0, 200);
      setLogs(combined);
      setLoading(false);
    };

    const unsubMasuk = onSnapshot(qMasuk, (snap) => {
      masukLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _source: 'MASUK' }));
      updateAll();
    }, (error) => {
      console.error("Error fetching masuk logs:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/masuk/records');
    });

    const unsubKeluar = onSnapshot(qKeluar, (snap) => {
      keluarLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _source: 'KELUAR' }));
      updateAll();
    }, (error) => {
      console.error("Error fetching keluar logs:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/keluar/records');
    });

    const unsubRetur = onSnapshot(qRetur, (snap) => {
      returLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _source: 'RETUR' }));
      updateAll();
    }, (error) => {
      console.error("Error fetching retur logs:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/retur/records');
    });

    const unsubKoreksi = onSnapshot(qKoreksi, (snap) => {
      koreksiLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _source: 'KOREKSI' }));
      updateAll();
    }, (error) => {
      console.error("Error fetching koreksi logs:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/koreksi/records');
    });

    const unsubInspeksi = onSnapshot(qInspeksi, (snap) => {
      inspeksiLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data(), _source: 'INSPEKSI' }));
      updateAll();
    }, (error) => {
      console.error("Error fetching inspeksi logs:", error);
      handleFirestoreError(error, OperationType.LIST, 'history/inspeksi/records');
    });

    return () => {
      unsubscribed = true;
      unsubMasuk();
      unsubKeluar();
      unsubRetur();
      unsubKoreksi();
      unsubInspeksi();
    };
  }, [filterDate, activeWarehouse]);

  const toggleSelectAll = () => {
    if (selectedLogs.length === filteredLogs.length && filteredLogs.length > 0) {
      setSelectedLogs([]);
    } else {
      setSelectedLogs([...filteredLogs]);
    }
  };

  const toggleSelect = (log: any) => {
    setSelectedLogs(prev => 
      prev.find(l => l.id === log.id) 
        ? prev.filter(l => l.id !== log.id) 
        : [...prev, log]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedLogs.length === 0) return;
    setShowBulkConfirm(true);
  };

  const confirmBulkDelete = async () => {
    setShowBulkConfirm(false);
    const itemsToDelete = [...selectedLogs];
    setIsBulkDeleting(true);
    setBulkProgress({ current: 0, total: itemsToDelete.length });
    
    let successCount = 0;
    let failCount = 0;
    let lastError = '';

    console.log(`Starting bulk delete for ${itemsToDelete.length} items...`);

    try {
      for (const log of itemsToDelete) {
        try {
          const type = getLogType(log);
          await deleteTransaction(type, log.id);
          successCount++;
        } catch (err) {
          console.error(`Bulk Delete Error for ID [${log.id}]:`, err);
          failCount++;
          if (err instanceof Error) lastError = err.message;
        }
        setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
      }
    } catch (err) {
      console.error('Fatal Bulk Delete Loop Error:', err);
      lastError = 'Kesalahan sistem saat iterasi penghapusan.';
    }

    console.log(`Bulk delete finished. Success: ${successCount}, Fail: ${failCount}`);

    setIsBulkDeleting(false);
    setSelectedLogs([]);
    
    if (failCount > 0) {
      window.alert(`Proses Selesai dengan kendala:\n${successCount} berhasil dihapus\n${failCount} gagal\n\nDetail Error: ${lastError || 'Tidak diketahui'}`);
    }
  };

  const handleDeleteAll = async () => {
    if (filteredLogs.length === 0) return;
    setShowDeleteAllConfirm(true);
  };

  const confirmDeleteAll = async () => {
    setShowDeleteAllConfirm(false);
    const itemsToDelete = [...filteredLogs];
    setIsBulkDeleting(true);
    setBulkProgress({ current: 0, total: itemsToDelete.length });
    
    let successCount = 0;
    let failCount = 0;
    let lastError = '';

    console.log(`Starting Delete All for ${itemsToDelete.length} items...`);

    try {
      for (const log of itemsToDelete) {
        try {
          const type = getLogType(log);
          await deleteTransaction(type, log.id);
          successCount++;
        } catch (err) {
          console.error(`Delete All Error for ID [${log.id}]:`, err);
          failCount++;
          if (err instanceof Error) lastError = err.message;
        }
        setBulkProgress(prev => ({ ...prev, current: prev.current + 1 }));
      }
    } catch (err) {
      console.error('Fatal Delete All Loop Error:', err);
      lastError = 'Kesalahan sistem saat proses pembersihan.';
    }

    setIsBulkDeleting(false);
    setSelectedLogs([]);
    
    if (failCount > 0) {
      window.alert(`Proses Selesai dengan kendala:\n${successCount} berhasil dihapus\n${failCount} gagal\n\nDetail: ${lastError || 'Tidak diketahui'}`);
    }
  };

  const filteredLogs = logs.filter(log => {
    const s = search.toLowerCase();
    
    // Extract date info
    const dateObj = log.date ? new Date(log.date) : (log.createdAt?.toDate ? log.createdAt.toDate() : null);
    const logDate = log.date || (dateObj ? dateObj.toISOString().split('T')[0] : '');
    const logYear = logDate.substring(0, 4);
    const logMonth = logDate.substring(5, 7);
    const logDay = logDate.substring(8, 10);

    const dateStr = log.date || (dateObj ? dateObj.toLocaleString('id-ID') : '');
    const typeStr = log.type || log._source || '';
    
    // General search matches any of the fields
    const matchesSearch = !search || (
      log.skuId?.toLowerCase().includes(s) || 
      log.skuName?.toLowerCase().includes(s) ||
      log.receiptId?.toLowerCase().includes(s) ||
      log.reason?.toLowerCase().includes(s) ||
      dateStr.toLowerCase().includes(s) ||
      typeStr.toLowerCase().includes(s)
    );

    // Advanced filters
    const matchesYear = !filters.year || logYear === filters.year;
    const matchesMonth = !filters.month || logMonth === filters.month;
    const matchesDay = !filters.day || logDay === filters.day;
    const matchesItem = !filters.inventoryItem || log.skuId === filters.inventoryItem;
    const matchesRef = !filters.reference || log.receiptId?.toLowerCase().includes(filters.reference.toLowerCase());
    const matchesReason = !filters.reason || log.reason === filters.reason;
    const matchesType = !filters.type || typeStr === filters.type;

    return matchesSearch && matchesYear && matchesMonth && matchesDay && matchesItem && matchesRef && matchesReason && matchesType;
  });

  // Calculate stats for current view
  const stats = filteredLogs.reduce((acc, log) => {
    const isPositive = log._source === 'MASUK' || log._source === 'RETUR' || log.type === 'RESTOCK' || log.type === 'MASUK' || log.type === 'RETUR';
    const isKoreksi = log.type === 'KOREKSI';
    const isPemusnahan = log.type === 'PEMUSNAHAN';
    const pcsPerCarton = log.pcsPerCarton || 1;
    const qty = Math.abs(log.quantity);
    
    if (isKoreksi) {
      // Logic for correction - usually skip from simple sum
    } else if (isPemusnahan) {
      acc.pemusnahanPcs += qty;
      if (pcsPerCarton > 1) {
        acc.pemusnahanDusCount += Math.floor(qty / pcsPerCarton);
        acc.pemusnahanRemPcs += qty % pcsPerCarton;
      } else {
        acc.pemusnahanRemPcs += qty;
      }
    } else if (isPositive) {
      acc.masukPcs += log.quantity;
      if (pcsPerCarton > 1) {
        acc.masukDusCount += Math.floor(log.quantity / pcsPerCarton);
        acc.masukRemPcs += log.quantity % pcsPerCarton;
      } else {
        acc.masukRemPcs += log.quantity;
      }
    } else {
      acc.keluarPcs += qty;
      if (pcsPerCarton > 1) {
        acc.keluarDusCount += Math.floor(qty / pcsPerCarton);
        acc.keluarRemPcs += qty % pcsPerCarton;
      } else {
        acc.keluarRemPcs += qty;
      }
    }
    return acc;
  }, { masukPcs: 0, masukDusCount: 0, masukRemPcs: 0, keluarPcs: 0, keluarDusCount: 0, keluarRemPcs: 0, pemusnahanPcs: 0, pemusnahanDusCount: 0, pemusnahanRemPcs: 0 });

  // Unique lists for dropdowns
  const uniqueItems = Array.from(new Set(logs.map(l => l.skuId))).filter(Boolean).sort();
  const uniqueReasons = Array.from(new Set(logs.map(l => l.reason))).filter(Boolean).sort();
  const uniqueTypes = Array.from(new Set(logs.map(l => l.type || l._source))).filter(Boolean).sort();
  const uniqueYears = Array.from(new Set(logs.map(l => String(l.date || '').substring(0, 4)))).filter((y: string) => y && y.length === 4).sort();
  const uniqueMonths = Array.from({length: 12}, (_, i) => (i + 1).toString().padStart(2, '0'));
  const uniqueDays = Array.from({length: 31}, (_, i) => (i + 1).toString().padStart(2, '0'));

  return (
    <div className="space-y-6">
      <AnimatePresence>
        {(showBulkConfirm || showDeleteAllConfirm) && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 border border-white/20"
            >
              <div className="bg-red-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-sm ring-1 ring-red-100 mx-auto">
                <AlertTriangle className="w-8 h-8 text-red-600" />
              </div>
              <h3 className="text-2xl font-black text-slate-900 mb-3 text-center">Konfirmasi Database</h3>
              <p className="text-slate-500 mb-4 text-center leading-relaxed">
                {showBulkConfirm 
                  ? `Apakah Anda yakin ingin menghapus ${selectedLogs.length} record data? Data akan hilang permanen.`
                  : `Apakah Anda yakin ingin menghapus SELURUH (${filteredLogs.length}) data yang tampil?`
                }
              </p>
              <div className="bg-amber-50 p-4 rounded-2xl mb-8 border border-amber-100 flex items-start gap-3">
                 <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                 <p className="text-xs text-amber-800 font-medium">
                  <strong>Penting:</strong> Penghapusan data akan mengembalikan (update otomatis) stok gudang.
                </p>
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkConfirm(false);
                    setShowDeleteAllConfirm(false);
                  }}
                  className="flex-1 px-6 py-3.5 bg-slate-50 text-slate-600 rounded-2xl font-bold hover:bg-slate-100 transition-all active:scale-95"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={showBulkConfirm ? confirmBulkDelete : confirmDeleteAll}
                  className="flex-1 px-6 py-3.5 bg-red-600 text-white rounded-2xl font-bold hover:bg-red-700 transition-all shadow-xl shadow-red-200 active:scale-95"
                >
                  Ya, Hapus
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showExportModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 border border-white/20"
            >
              <div className="flex items-center gap-4 mb-6">
                 <div className="bg-emerald-100 p-3 rounded-2xl">
                    <FileDown className="w-6 h-6 text-emerald-600" />
                 </div>
                 <div>
                    <h3 className="text-xl font-black text-slate-900 leading-tight">Konfigurasi Export Database</h3>
                    <p className="text-sm text-slate-400 font-medium tracking-tight">Pilih data yang ingin Anda sertakan dalam Excel.</p>
                 </div>
              </div>

              <div className="space-y-6 mb-8">
                 <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Item yang Diekspor</label>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                       <p className="text-sm font-bold text-slate-700">
                          {selectedLogs.length > 0 
                             ? `${selectedLogs.length} Log yang dipilih` 
                             : `Seluruh log yang tampil (${filteredLogs.length})`
                          }
                       </p>
                       <p className="text-[10px] text-slate-400 mt-1 uppercase font-black">
                          {selectedLogs.length > 0 
                             ? "Hanya baris bertanda ceklis yang akan masuk ke laporan" 
                             : "Gunakan filter tanggal atau pencarian untuk membatasi data"
                          }
                       </p>
                    </div>
                 </div>

                 <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Kolom Data (Fields)</label>
                    <div className="grid grid-cols-2 gap-3">
                       {[
                          { key: 'timestamp', label: 'Timestamp' },
                          { key: 'inventoryItem', label: 'Inventory Item' },
                          { key: 'reference', label: 'Reference' },
                          { key: 'transactionType', label: 'Type' },
                          { key: 'alasan', label: 'Alasan' },
                          { key: 'masukPcs', label: 'Masuk (PCS)' },
                          { key: 'masukDus', label: 'Masuk (DUS)' },
                          { key: 'keluarPcs', label: 'Keluar (PCS)' },
                          { key: 'keluarDus', label: 'Keluar (DUS)' }
                       ].map((field) => (
                          <label 
                             key={field.key}
                             className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                                exportFields[field.key as keyof typeof exportFields] 
                                ? 'bg-emerald-50 border-emerald-500/20 text-emerald-900' 
                                : 'bg-white border-slate-100 text-slate-400 hover:border-slate-200'
                             }`}
                          >
                             <input 
                                type="checkbox"
                                checked={exportFields[field.key as keyof typeof exportFields]}
                                onChange={() => setExportFields(prev => ({ ...prev, [field.key]: !prev[field.key as keyof typeof exportFields] }))}
                                className="hidden"
                             />
                             <div className={`w-5 h-5 rounded-md flex items-center justify-center border-2 transition-all ${
                                exportFields[field.key as keyof typeof exportFields] 
                                ? 'bg-emerald-600 border-emerald-600' 
                                : 'bg-transparent border-slate-200'
                             }`}>
                                {exportFields[field.key as keyof typeof exportFields] && <Plus className="w-3.5 h-3.5 text-white stroke-[4]" />}
                             </div>
                             <span className="text-[10px] font-black uppercase tracking-tight leading-none">{field.label}</span>
                          </label>
                       ))}
                    </div>
                 </div>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  className="flex-1 px-6 py-4 bg-slate-50 text-slate-600 rounded-2xl font-bold hover:bg-slate-100 transition-all active:scale-95"
                >
                  Batalkan
                </button>
                <button
                  type="button"
                  onClick={exportToExcel}
                  className="flex-1 px-6 py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-all shadow-xl shadow-emerald-200 active:scale-95 flex items-center justify-center gap-2"
                >
                  <FileDown className="w-5 h-5" />
                  <span>Download Excel</span>
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {showFilterModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 30 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg p-8 border border-white/20"
            >
              <div className="flex items-center justify-between mb-6">
                 <div className="flex items-center gap-4">
                    <div className="bg-indigo-100 p-3 rounded-2xl">
                       <Filter className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                       <h3 className="text-xl font-black text-slate-900 leading-tight">Filter Database</h3>
                       <p className="text-sm text-slate-400 font-medium tracking-tight">Cari data spesifik berdasarkan kategori.</p>
                    </div>
                 </div>
                 <button 
                   onClick={() => {
                     setFilters({
                       year: '',
                       month: '',
                       day: '',
                       inventoryItem: '',
                       reference: '',
                       reason: '',
                       type: ''
                     });
                   }}
                   className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
                 >
                   Reset Filter
                 </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                 {/* Timestamp Filters */}
                 <div className="col-span-2 grid grid-cols-3 gap-2">
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Tahun</label>
                      <select 
                         value={filters.year}
                         onChange={(e) => setFilters(prev => ({ ...prev, year: e.target.value }))}
                         className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                      >
                         <option value="">Semua Tahun</option>
                         {uniqueYears.map(y => <option key={y} value={y}>{y}</option>)}
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Bulan</label>
                      <select 
                         value={filters.month}
                         onChange={(e) => setFilters(prev => ({ ...prev, month: e.target.value }))}
                         className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                      >
                         <option value="">Semua Bulan</option>
                         {['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'].map((m, idx) => (
                            <option key={m} value={(idx + 1).toString().padStart(2, '0')}>{m}</option>
                         ))}
                      </select>
                   </div>
                   <div className="space-y-1.5">
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Tanggal</label>
                      <select 
                         value={filters.day}
                         onChange={(e) => setFilters(prev => ({ ...prev, day: e.target.value }))}
                         className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                      >
                         <option value="">Semua Tgl</option>
                         {uniqueDays.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                   </div>
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Inventory Item</label>
                    <select 
                       value={filters.inventoryItem}
                       onChange={(e) => setFilters(prev => ({ ...prev, inventoryItem: e.target.value }))}
                       className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                    >
                       <option value="">Semua Item</option>
                       {uniqueItems.map(skuId => (
                          <option key={skuId} value={skuId}>
                             {skuId} | {logs.find(l => l.skuId === skuId)?.skuName}
                          </option>
                       ))}
                    </select>
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Reference / Resi</label>
                    <input 
                       type="text"
                       value={filters.reference}
                       onChange={(e) => setFilters(prev => ({ ...prev, reference: e.target.value }))}
                       placeholder="Cari No Ref..."
                       className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none transition-all"
                    />
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Reason / Alasan</label>
                    <select 
                       value={filters.reason}
                       onChange={(e) => setFilters(prev => ({ ...prev, reason: e.target.value }))}
                       className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                    >
                       <option value="">Semua Alasan</option>
                       {uniqueReasons.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                 </div>

                 <div className="space-y-1.5">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Transaction Type</label>
                    <select 
                       value={filters.type}
                       onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value }))}
                       className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:border-indigo-400 outline-none"
                    >
                       <option value="">Semua Tipe</option>
                       {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                 </div>
              </div>

              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowFilterModal(false)}
                  className="flex-1 px-6 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-200 active:scale-95 text-sm uppercase tracking-widest"
                >
                  Terapkan Filter
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header & Stats removed or modified if needed, but the user specifically asked to remove the tab */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="bg-indigo-600/10 p-2 rounded-lg">
              <History className="w-6 h-6 text-indigo-600" />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Database Log</h2>
          </div>
          <p className="text-slate-500 font-medium italic">Riwayat transaksi dan rekapitulasi inventaris.</p>
        </div>

        <div className="flex bg-white/50 p-1.5 rounded-2xl border border-slate-200/60 backdrop-blur-sm shadow-sm items-center gap-3">
          <div className="pl-3 border-r border-slate-200 pr-3 py-1">
             <Calendar className={`w-5 h-5 ${!filterDate ? 'text-slate-300' : 'text-indigo-600 animate-pulse'}`} />
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="bg-transparent border-none outline-none font-black text-xs text-slate-700 uppercase tracking-widest focus:ring-0"
            />
            {filterDate && (
              <button 
                onClick={() => setFilterDate('')}
                className="w-6 h-6 flex items-center justify-center bg-slate-100 rounded-full hover:bg-slate-200 transition-colors"
                title="Clear Filter"
              >
                <X className="w-3 h-3 text-slate-500" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/30 overflow-hidden min-h-[500px] flex flex-col">
        <div className="p-6 border-b border-slate-100 flex flex-col xl:flex-row gap-4 items-stretch xl:items-center bg-slate-50/30">
          <div className="relative flex-1 group">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
            <input
              type="text"
              placeholder="Cari transaksi, SKU, atau no resi..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-medium text-slate-700 placeholder:text-slate-400 shadow-sm"
            />
          </div>
          
          <div className="flex flex-wrap items-center gap-3">
            <button 
              onClick={() => setShowFilterModal(true)}
              className="flex items-center gap-2 bg-indigo-50 text-indigo-600 border border-indigo-100 px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-indigo-100 transition-all active:scale-95"
            >
              <Filter className="w-4 h-4" />
              Filter Data
            </button>

            <button 
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-2 bg-emerald-600 text-white px-5 py-3 rounded-2xl text-xs font-black uppercase tracking-wider hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-100 active:scale-95"
            >
              <FileDown className="w-4 h-4" />
              Export Excel
            </button>
            
            <div className="h-8 w-px bg-slate-200 mx-1 hidden sm:block" />

            <div className="flex items-center gap-2 bg-slate-100/50 p-1 rounded-2xl border border-slate-200">
               <AnimatePresence mode="wait">
                  {isAdmin && (selectedLogs.length > 0 || (filteredLogs.length > 0 && search)) ? (
                    <motion.button 
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      onClick={selectedLogs.length > 0 ? handleBulkDelete : handleDeleteAll}
                      disabled={isBulkDeleting}
                      className="flex items-center gap-2 bg-red-600 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-700 transition shadow-lg shadow-red-200 active:scale-95 disabled:opacity-50"
                    >
                      {isBulkDeleting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                      {selectedLogs.length > 0 ? `Hapus (${selectedLogs.length})` : 'Hapus Semua'}
                    </motion.button>
                  ) : (
                    <div className="flex items-center gap-2 px-4 py-2 text-[10px] text-slate-400 font-black uppercase tracking-widest leading-none">
                      <Filter className="w-3.5 h-3.5" />
                      <span>{filterDate || 'Latest'} Entries</span>
                    </div>
                  )}
               </AnimatePresence>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100">
                <th className="px-8 py-5 w-4">
                  <input 
                    type="checkbox" 
                    className="w-4 h-4 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer"
                    checked={selectedLogs.length === filteredLogs.length && filteredLogs.length > 0}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className="px-4 py-5">Waktu</th>
                <th className="px-4 py-5">Barang</th>
                <th className="px-4 py-5">Referensi</th>
                <th className="px-4 py-5 font-bold text-slate-600">Alasan</th>
                <th className="px-4 py-5 font-bold text-slate-600">Tipe</th>
                <th className="px-2 py-5 text-center text-emerald-600">In (Dus)</th>
                <th className="px-2 py-5 text-center text-emerald-600">In (Pcs)</th>
                <th className="px-2 py-5 text-center text-rose-600">Out (Dus)</th>
                <th className="px-2 py-5 text-center text-rose-600">Out (Pcs)</th>
                <th className="px-8 py-5 text-right w-20">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={11} className="px-8 py-32 text-center text-slate-300">
                    <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-slate-100" />
                    <p className="text-sm font-bold tracking-widest uppercase">Synchronizing Data...</p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isSelected = !!selectedLogs.find(l => l.id === log.id);
                  const isPositive = log._source === 'MASUK' || log._source === 'RETUR' || log.type === 'RESTOCK' || log.type === 'MASUK' || log.type === 'RETUR';
                  
                  return (
                    <tr key={log.id} className={`group transition-all duration-200 ${isSelected ? 'bg-indigo-50/50' : 'hover:bg-slate-50/50'}`}>
                      <td className="px-8 py-5">
                        <input 
                          type="checkbox" 
                          className="w-4 h-4 rounded-md border-slate-300 text-indigo-600 focus:ring-indigo-500 transition-all cursor-pointer opacity-40 group-hover:opacity-100 checked:opacity-100"
                          checked={isSelected}
                          onChange={() => toggleSelect(log)}
                        />
                      </td>
                      <td className="px-4 py-5 whitespace-nowrap">
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-slate-900 tabular-nums">
                            {log.date || (log.createdAt?.toDate ? log.createdAt.toDate().toLocaleDateString('id-ID') : '-')}
                          </span>
                          <span className="text-[9px] text-slate-400 font-bold uppercase tracking-tighter">
                            {log.createdAt?.toDate ? log.createdAt.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : 'Recorded'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-slate-800 group-hover:text-indigo-600 transition-colors uppercase">{log.skuName}</span>
                          <span className="text-[10px] font-black font-mono text-slate-400 tracking-widest">{log.skuId}</span>
                        </div>
                      </td>
                      <td className="px-4 py-5">
                         <span className="text-xs font-bold text-slate-500 tabular-nums bg-slate-100/50 px-2.5 py-1 rounded-lg border border-slate-200/40">
                           {log.receiptId || 'DIRECT'}
                         </span>
                      </td>
                      <td className="px-4 py-5">
                         <p className="text-[11px] font-bold text-slate-600 italic line-clamp-2 max-w-[180px]">
                           {log.reason ? `"${log.reason}"` : '-'}
                         </p>
                      </td>
                      <td className="px-4 py-5">
                        <span className={`text-[9px] font-black px-2.5 py-1 rounded-xl uppercase tracking-widest border ${
                          isPositive 
                            ? (log._source === 'RETUR' || log.type === 'RETUR' ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-emerald-50 text-emerald-600 border-emerald-100')
                            : log.type === 'PEMUSNAHAN'
                              ? 'bg-slate-100 text-slate-600 border-slate-200'
                              : log.type === 'SCAN KELUAR' || log.type === 'SALE'
                                ? 'bg-blue-50 text-blue-600 border-blue-100'
                                : 'bg-orange-50 text-orange-600 border-orange-100'
                        }`}>
                          {log.type || log._source}
                        </span>
                      </td>
                      <td className="px-2 py-5 text-center">
                        {isPositive ? (
                           <div className="flex flex-col items-center">
                             <div className="flex flex-col items-center gap-0.5">
                                <span id={`masuk-dus-${log.id}`} className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-100">
                                  {log.pcsPerCarton && log.pcsPerCarton > 1 ? Math.floor(log.quantity / log.pcsPerCarton) : 0} DUS
                                </span>
                                {log.inputMode === 'CARTON' && log.pcsPerCarton > 1 && (
                                  <span className="text-[8px] font-black text-indigo-400 uppercase tracking-tighter">
                                    ISI {log.pcsPerCarton} PCS
                                  </span>
                                )}
                             </div>
                             {(log.quantity % (log.pcsPerCarton || 1) > 0 || (log.pcsPerCarton <= 1 && log.quantity > 0)) && (
                               <span id={`masuk-pcs-${log.id}`} className="text-[8px] font-bold text-emerald-500 uppercase mt-0.5">
                                 + {log.pcsPerCarton <= 1 ? log.quantity : log.quantity % log.pcsPerCarton} PCS
                               </span>
                             )}
                           </div>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-2 py-5 text-center">
                        {isPositive ? (
                           <span className="text-xs font-black text-emerald-600">+{log.quantity}</span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-2 py-5 text-center">
                        {!isPositive ? (
                           <div className="flex flex-col items-center">
                             <div className="flex flex-col items-center gap-0.5">
                                <span className="text-[10px] font-black text-rose-600 bg-rose-50 px-2 py-1 rounded border border-rose-100">
                                  {log.pcsPerCarton && log.pcsPerCarton > 1 ? Math.floor(Math.abs(log.quantity) / log.pcsPerCarton) : 0} DUS
                                </span>
                                {log.inputMode === 'CARTON' && log.pcsPerCarton > 1 && (
                                  <span className="text-[8px] font-black text-indigo-400 uppercase tracking-tighter">
                                    ISI {log.pcsPerCarton} PCS
                                  </span>
                                )}
                             </div>
                             {(Math.abs(log.quantity) % (log.pcsPerCarton || 1) > 0 || (log.pcsPerCarton <= 1 && Math.abs(log.quantity) > 0)) && (
                               <span className="text-[8px] font-bold text-rose-500 uppercase mt-0.5">
                                 + {log.pcsPerCarton <= 1 ? Math.abs(log.quantity) : Math.abs(log.quantity) % log.pcsPerCarton} PCS
                               </span>
                             )}
                           </div>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-2 py-5 text-center">
                        {!isPositive ? (
                           <span className="text-xs font-black text-rose-600">-{Math.abs(log.quantity)}</span>
                        ) : (
                          <span className="text-[10px] font-bold text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-8 py-5 text-right relative">
                        {isAdmin && (
                          <AnimatePresence mode="wait">
                            {confirmDeleteId === log.id ? (
                              <motion.div 
                                initial={{ opacity: 0, x: 10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 10 }}
                                className="flex items-center justify-end gap-1.5"
                              >
                                <button
                                  onClick={() => handleDelete(log)}
                                  className="w-8 h-8 flex items-center justify-center bg-red-600 text-white rounded-lg shadow-lg shadow-red-200 hover:bg-red-700 transition-all active:scale-95"
                                  title="Konfirmasi Hapus"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="w-8 h-8 flex items-center justify-center bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 transition-all"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </motion.div>
                            ) : (
                              <button
                                onClick={() => setConfirmDeleteId(log.id)}
                                disabled={isDeleting === log.id}
                                className="w-10 h-10 flex items-center justify-center text-slate-200 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all opacity-0 group-hover:opacity-100 transform translate-x-2 group-hover:translate-x-0 disabled:opacity-30"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </AnimatePresence>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
              {!loading && filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-8 py-40">
                    <div className="flex flex-col items-center justify-center text-center">
                      <div className="w-24 h-24 bg-slate-50 rounded-[2rem] flex items-center justify-center mb-6 text-slate-200 group-hover:bg-indigo-50 group-hover:text-indigo-200 transition-colors">
                        <History className="w-12 h-12" />
                      </div>
                      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-2">Data Tidak Ditemukan</h3>
                      <p className="text-sm text-slate-400 font-medium max-w-xs mx-auto">
                        Coba sesuaikan filter atau kata kunci pencarian Anda untuk menemukan data yang dicari.
                      </p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
            {/* Summary Statistics Row */}
            {!loading && filteredLogs.length > 0 && (
               <tfoot className="bg-slate-900 border-t-2 border-indigo-500 sticky bottom-0 z-10 shadow-2xl">
                  <tr className="text-white font-black uppercase text-[10px] tracking-widest">
                     <td colSpan={6} className="px-8 py-4 text-right border-r border-white/5">RINGKASAN FILTER</td>
                     <td className="px-2 py-4 text-center border-r border-white/5 bg-emerald-900/40">
                        <div className="flex flex-col">
                           <span className="text-emerald-400">{stats.masukDusCount} DUS</span>
                           {stats.masukRemPcs > 0 && <span className="text-[8px] text-emerald-500/70">+ {stats.masukRemPcs} PCS</span>}
                        </div>
                     </td>
                     <td className="px-2 py-4 text-center border-r border-white/5 bg-emerald-900/60">
                        {stats.masukPcs.toLocaleString()} PCS
                     </td>
                     <td className="px-2 py-4 text-center border-r border-white/5 bg-rose-900/40">
                        <div className="flex flex-col">
                           <span className="text-rose-400">{stats.keluarDusCount} DUS</span>
                           {stats.keluarRemPcs > 0 && <span className="text-[8px] text-rose-500/70">+ {stats.keluarRemPcs} PCS</span>}
                        </div>
                     </td>
                     <td className="px-2 py-4 text-center border-r border-white/5 bg-rose-900/60">
                        {stats.keluarPcs.toLocaleString()} PCS
                     </td>
                     <td className="px-4 py-4 text-center bg-slate-800 border-l border-white/10">
                        <div className="flex flex-col">
                           <span className="text-slate-400">DISPOSE</span>
                           <span className="text-rose-500">{stats.pemusnahanPcs.toLocaleString()} PCS</span>
                        </div>
                     </td>
                  </tr>
               </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
};

export default HistoryLogs;
