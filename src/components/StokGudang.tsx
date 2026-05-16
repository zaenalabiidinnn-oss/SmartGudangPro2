import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, setDoc, deleteDoc, query, where } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { processTransaction } from '../services/rekapService';
import { SKU } from '../types';
import { Package, Plus, Trash2, Search, Edit2, Save, X, AlertTriangle, Bell, Loader2, Send, FileDown, Filter } from 'lucide-react';
import { utils, writeFile, read } from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';

interface StokGudangProps {
  role?: string | null;
}

const StokGudang: React.FC<StokGudangProps> = ({ role }) => {
  const { activeWarehouse } = useWarehouse();
  const isAdmin = role === 'ADMIN';
  const [skus, setSkus] = useState<SKU[]>([]);
  const [newSKU, setNewSKU] = useState({ id: '', name: '', threshold: 10, initialBoxes: 0, pcsPerCarton: 1 });
  const [search, setSearch] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isDeletingSKU, setIsDeletingSKU] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [editingSKUId, setEditingSKUId] = useState<string | null>(null);
  const [editID, setEditID] = useState('');
  const [editName, setEditName] = useState('');
  const [editThreshold, setEditThreshold] = useState(10);

  const [editDetailedStock, setEditDetailedStock] = useState<Record<string, number | { total: number; boxes: number }>>({});
  const [displayCartonSize, setDisplayCartonSize] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!activeWarehouse) return;

    const q = query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id));
    const unsub = onSnapshot(q, (snap) => {
      setSkus(snap.docs.map(doc => {
        const data = doc.data();
        return { ...data, id: data.id || doc.id.split('_').slice(1).join('_') } as SKU;
      }));
    }, (error) => {
      console.error("Error fetching skus:", error);
      handleFirestoreError(error, OperationType.LIST, 'skus');
    });
    return unsub;
  }, [activeWarehouse]);

  const addSKU = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSKU.name || !newSKU.id || !activeWarehouse) {
      window.alert('Mohon isi Kode SKU, Nama Barang, dan pastikan Gudang terpilih!');
      return;
    }

    const internalId = `${activeWarehouse.id}_${newSKU.id}`;
    const initialStock = newSKU.initialBoxes * newSKU.pcsPerCarton;
    const sizeStr = String(newSKU.pcsPerCarton || 1);

    try {
      // 1. Create SKU with 0 stock first so processTransaction can find it
      await setDoc(doc(db, 'skus', internalId), {
        id: newSKU.id,
        name: newSKU.name,
        currentStock: 0,
        threshold: newSKU.threshold,
        pcsPerCarton: newSKU.pcsPerCarton,
        detailedStock: { [sizeStr]: { total: 0, boxes: 0 } },
        lastUpdated: new Date(),
        warehouseId: activeWarehouse.id
      });

      // 2. If there's initial stock, record as MASUK transaction
      if (initialStock > 0) {
        await processTransaction('MASUK', {
          skuId: newSKU.id,
          quantity: initialStock,
          date: new Date().toISOString().split('T')[0],
          warehouseId: activeWarehouse.id,
          reason: 'Stok Awal (Input SKU Baru)',
          pcsPerCarton: newSKU.pcsPerCarton
        });
      }

      setNewSKU({ id: '', name: '', threshold: 10, initialBoxes: 0, pcsPerCarton: 1 });
      setIsAdding(false);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `skus/${internalId}`);
      alert('Gagal menambah SKU.');
    }
  };

  const deleteSKU = async (id: string) => {
    if (!activeWarehouse) return;
    const internalId = `${activeWarehouse.id}_${id}`;
    setConfirmDeleteId(null);
    setIsDeletingSKU(id);
    try {
      await deleteDoc(doc(db, 'skus', internalId));
      setSelectedIds(prev => prev.filter(i => i !== id));
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.DELETE, `skus/${internalId}`);
      window.alert('Gagal menghapus SKU: ' + (err instanceof Error ? err.message : 'Unknown error'));
    } finally {
      setIsDeletingSKU(null);
    }
  };

  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [filters, setFilters] = useState({
    id: '',
    name: '',
    currentStock: '',
    threshold: ''
  });
  const [exportFields, setExportFields] = useState({
    id: true,
    name: true,
    currentStock: true,
    totalDus: true,
    threshold: true
  });

  const handleBulkDelete = async () => {
    if (selectedIds.length === 0) return;
    setShowBulkConfirm(true);
  };

  const confirmBulkDelete = async () => {
    setShowBulkConfirm(false);
    setIsBulkDeleting(true);
    console.log("Mencoba hapus masal SKU IDs:", selectedIds);
    
    let successCount = 0;
    let failCount = 0;
    let lastError = "";

    try {
      for (const id of selectedIds) {
        try {
          await deleteDoc(doc(db, 'skus', id));
          successCount++;
        } catch (err) {
          console.error(`Gagal menghapus SKU [${id}]:`, err);
          failCount++;
          if (err instanceof Error) lastError = err.message;
        }
      }

      if (failCount > 0) {
        window.alert(`Hapus selesai dengan kendala:\n${successCount} Berhasil\n${failCount} Gagal\n\nError: ${lastError || 'Unknown'}`);
      } else {
        // Optional: show toast instead of alert
      }
    } catch (err) {
      console.error('Fatal Error Hapus Masal:', err);
      window.alert('Kesalahan Sistem: ' + (err instanceof Error ? err.message : 'Error tidak diketahui'));
    } finally {
      setIsBulkDeleting(false);
      setSelectedIds([]);
    }
  };

  const confirmBulkDeleteExecute = async () => {
    if (!activeWarehouse) return;
    setShowBulkConfirm(false);
    setIsBulkDeleting(true);
    
    let successCount = 0;
    let failCount = 0;
 
    for (const id of selectedIds) {
      try {
        const internalId = `${activeWarehouse.id}_${id}`;
        await deleteDoc(doc(db, 'skus', internalId));
        successCount++;
      } catch (err) {
        failCount++;
      }
    }
    setIsBulkDeleting(false);
    setSelectedIds([]);
  };

  const handleDeleteAll = async () => {
    if (filteredSkus.length === 0) return;
    setShowDeleteAllConfirm(true);
  };

  const confirmDeleteAll = async () => {
    if (!activeWarehouse) return;
    setShowDeleteAllConfirm(false);
    setIsBulkDeleting(true);
    
    for (const sku of filteredSkus) {
      try {
        const internalId = `${activeWarehouse.id}_${sku.id}`;
        await deleteDoc(doc(db, 'skus', internalId));
      } catch (err) {
        console.error(err);
      }
    }
    setIsBulkDeleting(false);
    setSelectedIds([]);
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === filteredSkus.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(filteredSkus.map(s => s.id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const startEditing = (sku: SKU) => {
    setEditingSKUId(sku.id);
    setEditID(sku.id);
    setEditName(sku.name);
    setEditThreshold(sku.threshold ?? 10);
    setEditDetailedStock(sku.detailedStock || {});
  };

  const cancelEditing = () => {
    setEditingSKUId(null);
  };

  const handleSave = async (oldId: string) => {
    if (!activeWarehouse) return;
    const oldInternalId = `${activeWarehouse.id}_${oldId}`;
    const newInternalId = `${activeWarehouse.id}_${editID}`;
    
    // Calculate new currentStock from detailedStock
    const newTotalStock = Object.values(editDetailedStock).reduce((acc, val) => {
      const count = typeof val === 'object' && val !== null ? (val as any).total : Number(val);
      return acc + count;
    }, 0);

    try {
      const updatePayload: any = {
        name: editName,
        threshold: editThreshold,
        detailedStock: editDetailedStock,
        currentStock: newTotalStock,
        lastUpdated: new Date()
      };

      if (editID !== oldId) {
        // ID Changed: Check if new ID already exists
        const existingSku = skus.find(s => s.id === editID);
        if (existingSku) {
           window.alert(`SKU dengan kode "${editID}" sudah ada di gudang ini.`);
           return;
        }

        // Renaming: set new doc with all data and delete old one
        await setDoc(doc(db, 'skus', newInternalId), {
          ...updatePayload,
          id: editID,
          warehouseId: activeWarehouse.id
        });
        await deleteDoc(doc(db, 'skus', oldInternalId));
      } else {
        // No ID change: Simple update
        await setDoc(doc(db, 'skus', oldInternalId), updatePayload, { merge: true });
      }
      setEditingSKUId(null);
    } catch (err) {
      console.error(err);
      window.alert('Gagal mengupdate SKU.');
    }
  };

  const downloadTemplate = () => {
    const worksheet = utils.aoa_to_sheet([["Kode SKU", "Nama Barang", "Stok (PCS)", "Total Dus", "Threshold"]]);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Template SKU');
    writeFile(workbook, `Template_Input_SKU.xlsx`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeWarehouse) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = utils.sheet_to_json(ws) as any[];

        if (data.length === 0) {
          window.alert("File kosong atau format salah.");
          return;
        }

        setIsBulkDeleting(true); // Reuse loading state for progress feedback
        let importCount = 0;

        for (const row of data) {
          const skuId = String(row["Kode SKU"] || "").trim().toUpperCase();
          const name = String(row["Nama Barang"] || "").trim();
          const threshold = Number(row["Threshold"]) || 10;
          const initialStock = Number(row["Stok (PCS)"]) || 0;
          
          if (!skuId || !name) continue;

          const internalId = `${activeWarehouse.id}_${skuId}`;
          const pcsPerCarton = 1; // Default for import if not specified

          // 1. Create SKU
          await setDoc(doc(db, 'skus', internalId), {
            id: skuId,
            name: name,
            currentStock: 0, // Set to 0 then add via transaction if initialStock > 0
            threshold: threshold,
            pcsPerCarton: pcsPerCarton,
            detailedStock: { ["1"]: { total: 0, boxes: 0 } },
            lastUpdated: new Date(),
            warehouseId: activeWarehouse.id
          });

          // 2. Add initial stock via transaction
          if (initialStock > 0) {
            await processTransaction('MASUK', {
              skuId: skuId,
              quantity: initialStock,
              date: new Date().toISOString().split('T')[0],
              warehouseId: activeWarehouse.id,
              reason: 'Import Awal (Excel)',
              pcsPerCarton: pcsPerCarton
            });
          }
          importCount++;
        }

        window.alert(`Berhasil mengimport ${importCount} SKU.`);
      } catch (err) {
        console.error(err);
        window.alert("Gagal membaca file Excel. Pastikan format kolom sesuai template.");
      } finally {
        setIsBulkDeleting(false);
        e.target.value = ""; // Clear input
      }
    };
    reader.readAsBinaryString(file);
  };

  const exportToExcel = () => {
    const itemsToExport = selectedIds.length > 0 
      ? skus.filter(s => selectedIds.includes(s.id))
      : filteredSkus;

    if (itemsToExport.length === 0) {
      downloadTemplate();
      setShowExportModal(false);
      return;
    }

    const dataToExport = itemsToExport.map(sku => {
      const row: any = {};
      const totalStock = sku.currentStock || 0;
      const isi = sku.pcsPerCarton || 1;
      
      const totalBoxes = isi > 1 ? Math.floor(totalStock / isi) : 0;
      const remPcs = isi > 1 ? totalStock % isi : totalStock;

      const totalDusFormatted = isi > 1 
        ? `${totalBoxes} DUS${remPcs > 0 ? ` + ${remPcs} PCS` : ''} (ISI ${isi})`
        : `${totalStock} PCS (ECERAN)`;

      if (exportFields.id) row['Kode SKU'] = sku.id;
      if (exportFields.name) row['Nama Barang'] = sku.name;
      if (exportFields.currentStock) row['Stok (PCS)'] = totalStock;
      if (exportFields.totalDus) row['Total Dus'] = totalDusFormatted;
      if (exportFields.threshold) row['Threshold'] = sku.threshold ?? 10;
      return row;
    });

    const worksheet = utils.json_to_sheet(dataToExport);
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Stok Gudang');
    
    // Generate filename with current date
    const date = new Date().toISOString().split('T')[0];
    writeFile(workbook, `Stok_Gudang_${date}.xlsx`);
    setShowExportModal(false);
  };

  const filteredSkus = skus.filter(s => {
    const searchLower = search.toLowerCase();
    
    // General search matches any of the fields
    const matchesSearch = !search || (
      s.id.toLowerCase().includes(searchLower) || 
      s.name.toLowerCase().includes(searchLower)
    );

    // Advanced filters
    const matchesId = !filters.id || s.id.toLowerCase().includes(filters.id.toLowerCase());
    const matchesName = !filters.name || s.name.toLowerCase().includes(filters.name.toLowerCase());
    const matchesStock = !filters.currentStock || String(s.currentStock).includes(filters.currentStock);
    const matchesThreshold = !filters.threshold || String(s.threshold ?? 10).includes(filters.threshold);

    return matchesSearch && matchesId && matchesName && matchesStock && matchesThreshold;
  }).sort((a, b) => a.currentStock - b.currentStock);

  const lowStockSkus = skus.filter(sku => sku.currentStock <= (sku.threshold ?? 10));

  return (
    <div className="space-y-8">
      {/* Custom Confirmation Modals */}
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
              <h3 className="text-2xl font-black text-slate-900 mb-3 text-center">Konfirmasi Hapus</h3>
              <p className="text-slate-500 mb-8 text-center leading-relaxed">
                {showBulkConfirm 
                  ? `Apakah Anda yakin ingin menghapus ${selectedIds.length} SKU yang dipilih? Seluruh riwayat akan terpengaruh.`
                  : `Apakah Anda yakin ingin menghapus SELURUH (${filteredSkus.length}) SKU yang tampil? Tindakan ini permanen.`
                }
              </p>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setShowBulkConfirm(false);
                    setShowDeleteAllConfirm(false);
                  }}
                  className="flex-1 px-6 py-3.5 bg-slate-50 text-slate-600 rounded-2xl font-bold hover:bg-slate-100 transition-all active:scale-95"
                >
                  Batalkan
                </button>
                <button
                  type="button"
                  onClick={showBulkConfirm ? confirmBulkDeleteExecute : confirmDeleteAll}
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
                    <h3 className="text-xl font-black text-slate-900 leading-tight">Konfigurasi Export</h3>
                    <p className="text-sm text-slate-400 font-medium tracking-tight">Pilih data yang ingin Anda sertakan dalam Excel.</p>
                 </div>
              </div>

              <div className="space-y-6 mb-8">
                 <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Item yang Diekspor</label>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                       <p className="text-sm font-bold text-slate-700">
                          {selectedIds.length > 0 
                             ? `${selectedIds.length} Item yang dipilih` 
                             : `Seluruh item (${filteredSkus.length}) yang tampil`
                          }
                       </p>
                       <p className="text-[10px] text-slate-400 mt-1 uppercase font-black">
                          {selectedIds.length > 0 
                             ? "Hanya item bertanda ceklis yang akan masuk ke laporan" 
                             : "Gunakan filter pencarian atau pilih item secara manual"
                          }
                       </p>
                    </div>
                 </div>

                 <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-4">Kolom Data (Fields)</label>
                    <div className="grid grid-cols-2 gap-3">
                       {[
                          { key: 'id', label: 'Kode SKU' },
                          { key: 'name', label: 'Nama Barang' },
                          { key: 'currentStock', label: 'Stok (PCS)' },
                          { key: 'totalDus', label: 'Total Dus' },
                          { key: 'threshold', label: 'Threshold' }
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
                             <span className="text-sm font-black uppercase tracking-tight">{field.label}</span>
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
                       <h3 className="text-xl font-black text-slate-900 leading-tight">Filter Stok Gudang</h3>
                       <p className="text-sm text-slate-400 font-medium tracking-tight">Cari barang spesifik berdasarkan kolom.</p>
                    </div>
                 </div>
                 <button 
                   onClick={() => {
                     setFilters({
                       id: '',
                       name: '',
                       currentStock: '',
                       threshold: ''
                     });
                   }}
                   className="text-[10px] font-black text-indigo-600 uppercase tracking-widest hover:underline"
                 >
                   Reset Filter
                 </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                 {[
                    { key: 'id', label: 'Kode SKU', placeholder: 'Ketik SKU...' },
                    { key: 'name', label: 'Nama Barang', placeholder: 'Ketik Nama...' },
                    { key: 'currentStock', label: 'Stok Saat Ini', placeholder: 'Berapa stok...' },
                    { key: 'threshold', label: 'Threshold', placeholder: 'Limit Threshold...' }
                 ].map((field) => (
                    <div key={field.key} className="space-y-1.5">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">{field.label}</label>
                       <input 
                          type="text"
                          value={filters[field.key as keyof typeof filters]}
                          onChange={(e) => setFilters(prev => ({ ...prev, [field.key]: e.target.value }))}
                          placeholder={field.placeholder}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all"
                       />
                    </div>
                 ))}
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

      {/* Header & Stats */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-indigo-600/10 p-2 rounded-lg">
              <Package className="w-6 h-6 text-indigo-600" />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight">Stok Gudang</h2>
          </div>
          <p className="text-slate-500 font-medium">Monitoring inventaris dan kontrol stok secara real-time.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-white px-4 py-2.5 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-3 group hover:border-indigo-200 transition-colors cursor-default">
            <div className="bg-slate-100 w-8 h-8 rounded-lg flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
              <Package className="w-4 h-4 text-slate-500 group-hover:text-indigo-600" />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Total SKU</p>
              <p className="text-sm font-black text-slate-800">{skus.length}</p>
            </div>
          </div>

          <div className={`bg-white px-4 py-2.5 rounded-2xl border shadow-sm flex items-center gap-3 group transition-all duration-300 ${lowStockSkus.length > 0 ? 'border-red-100 bg-red-50/30' : 'border-slate-200 hover:border-emerald-200'} cursor-default`}>
            <div className={`${lowStockSkus.length > 0 ? 'bg-red-100 animate-pulse' : 'bg-slate-100'} w-8 h-8 rounded-lg flex items-center justify-center group-hover:bg-opacity-80 transition-colors`}>
              <Bell className={`w-4 h-4 ${lowStockSkus.length > 0 ? 'text-red-600' : 'text-slate-500'}`} />
            </div>
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Stok Rendah</p>
              <p className={`text-sm font-black ${lowStockSkus.length > 0 ? 'text-red-600' : 'text-slate-800'}`}>{lowStockSkus.length}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white/50 backdrop-blur-sm p-3 rounded-2xl border border-slate-200 flex flex-col xl:flex-row gap-3 items-stretch shadow-sm">
        <div className="flex-1 flex gap-2">
            <div className="relative flex-1 group">
              <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
              <input
                type="text"
                placeholder="Cari SKU atau nama barang..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-medium text-slate-700 placeholder:text-slate-400 shadow-sm"
              />
            </div>
            {isAdmin && (
              <button
                 onClick={() => setIsAdding(!isAdding)}
                 className={`flex items-center gap-2 px-5 py-3 rounded-xl font-bold transition-all active:scale-95 shadow-sm ${
                   isAdding 
                     ? 'bg-slate-100 text-slate-600 hover:bg-slate-200' 
                     : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100 shadow-xl'
                 }`}
               >
                 {isAdding ? <X className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                 <span className="hidden sm:inline">{isAdding ? 'Tutup Panel' : 'Tambah SKU'}</span>
              </button>
            )}
        </div>

        <div className="flex items-center gap-2">
           <button 
              onClick={() => setShowFilterModal(true)}
              className="flex items-center gap-2 bg-indigo-50 text-indigo-600 border border-indigo-100 px-5 py-3 rounded-xl text-sm font-bold hover:bg-indigo-100 transition-all active:scale-95"
            >
              <Filter className="w-5 h-5" />
              <span className="hidden sm:inline">Filter Data</span>
            </button>

           <button
             onClick={downloadTemplate}
             className="flex items-center gap-2 px-5 py-3 bg-slate-900 text-white rounded-xl font-bold hover:bg-black transition-all active:scale-95 shadow-xl shadow-slate-200"
             title="Download Template Excel untuk Import"
           >
             <FileDown className="w-5 h-5 text-indigo-400" />
             <span className="hidden sm:inline">Template Import</span>
           </button>

           <div className="relative">
             <input
               type="file"
               accept=".xlsx, .xls"
               onChange={handleImport}
               className="hidden"
               id="excel-import"
             />
             <label
               htmlFor="excel-import"
               className="flex items-center gap-2 px-5 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-600 transition-all active:scale-95 shadow-xl shadow-amber-100 cursor-pointer"
             >
               <FileDown className="w-5 h-5 rotate-180" />
               <span className="hidden sm:inline">Import Excel</span>
             </label>
           </div>

           <button
             onClick={() => setShowExportModal(true)}
             className="flex items-center gap-2 px-5 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-all active:scale-95 shadow-xl shadow-emerald-100"
           >
             <FileDown className="w-5 h-5" />
             <span className="hidden sm:inline">Export Excel</span>
           </button>

           <div className="h-8 w-px bg-slate-200 mx-2 hidden xl:block" />
           
           <div className="flex items-center gap-2 bg-slate-100/50 p-1 rounded-xl border border-slate-200">
             <div className="flex items-center gap-2 px-3 py-1.5 cursor-pointer select-none" onClick={toggleSelectAll}>
               <input 
                 type="checkbox"
                 checked={selectedIds.length === filteredSkus.length && filteredSkus.length > 0}
                 onChange={toggleSelectAll}
                 className="w-4 h-4 rounded-md text-indigo-600 focus:ring-indigo-500 border-slate-300 transition-all cursor-pointer"
               />
               <span className="text-xs font-black text-slate-500 uppercase tracking-tighter">Pilih Semua</span>
             </div>
             
             <AnimatePresence>
               {isAdmin && (selectedIds.length > 0 || (filteredSkus.length > 0 && search)) && (
                 <motion.button
                   initial={{ opacity: 0, scale: 0.9, x: 10 }}
                   animate={{ opacity: 1, scale: 1, x: 0 }}
                   exit={{ opacity: 0, scale: 0.9, x: 10 }}
                   onClick={selectedIds.length > 0 ? handleBulkDelete : handleDeleteAll}
                   disabled={isBulkDeleting}
                   className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg text-xs font-bold hover:bg-red-700 transition shadow-lg shadow-red-200 active:scale-95 disabled:opacity-50"
                 >
                   {isBulkDeleting ? (
                     <Loader2 className="w-3.5 h-3.5 animate-spin" />
                   ) : (
                     <Trash2 className="w-3.5 h-3.5" />
                   )}
                   {selectedIds.length > 0 ? `Hapus (${selectedIds.length})` : 'Hapus Semua'}
                 </motion.button>
               )}
             </AnimatePresence>
           </div>
        </div>
      </div>

      {/* Add SKU Form */}
      <AnimatePresence>
        {isAdding && (
          <motion.div
            initial={{ height: 0, opacity: 0, scale: 0.98 }}
            animate={{ height: 'auto', opacity: 1, scale: 1 }}
            exit={{ height: 0, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="overflow-hidden"
          >
            <form onSubmit={addSKU} className="bg-white p-6 rounded-2xl border-2 border-indigo-100 shadow-xl shadow-indigo-50/50 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
              <div className="space-y-1.5">
                <label className="text-[10px] font-black text-indigo-600 uppercase tracking-widest pl-1">Kode SKU</label>
                <input
                  placeholder="e.g. SKU-123"
                  value={newSKU.id}
                  onChange={(e) => setNewSKU({ ...newSKU, id: e.target.value.toUpperCase() })}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-mono font-bold uppercase"
                />
              </div>
              <div className="space-y-1.5 md:col-span-1">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Nama Barang</label>
                <input
                  placeholder="Masukkan nama barang lengkap..."
                  value={newSKU.name}
                  onChange={(e) => setNewSKU({ ...newSKU, name: e.target.value })}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-bold"
                />
              </div>
              <div className="flex flex-wrap gap-4 md:col-span-4 items-end">
                <div className="space-y-1.5 flex-1 min-w-[150px]">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Jumlah Dus</label>
                  <input
                    type="number"
                    value={newSKU.initialBoxes}
                    onChange={(e) => setNewSKU({ ...newSKU, initialBoxes: Number(e.target.value) })}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-bold tabular-nums"
                  />
                </div>
                <div className="space-y-1.5 flex-1 min-w-[150px]">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Isi (Pcs/Dus)</label>
                  <input
                    type="number"
                    value={newSKU.pcsPerCarton}
                    onChange={(e) => setNewSKU({ ...newSKU, pcsPerCarton: Number(e.target.value) })}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-bold tabular-nums"
                  />
                </div>
                <div className="bg-indigo-50 p-3 rounded-xl border border-indigo-100 flex-1 min-w-[120px] flex flex-col justify-center">
                  <span className="text-[9px] font-black text-indigo-400 uppercase tracking-tight">Total Stok Awal</span>
                  <p className="text-sm font-black text-indigo-700 tabular-nums">{(newSKU.initialBoxes * (newSKU.pcsPerCarton || 0)).toLocaleString()} PCS</p>
                </div>
                <div className="space-y-1.5 flex-1 min-w-[100px]">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Threshold</label>
                  <input
                    type="number"
                    value={newSKU.threshold}
                    onChange={(e) => setNewSKU({ ...newSKU, threshold: Number(e.target.value) })}
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-bold tabular-nums"
                  />
                </div>
                <button type="submit" className="bg-indigo-600 text-white px-8 py-3 rounded-xl font-black text-sm uppercase tracking-wide hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-95">
                  Simpan SKU Baru
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* SKU Table */}
      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-50/50 text-slate-400 text-[10px] uppercase font-black tracking-[0.2em] border-b border-slate-100">
                <th className="px-4 py-5 w-12">
                   <input 
                     type="checkbox"
                     checked={selectedIds.length === filteredSkus.length && filteredSkus.length > 0}
                     onChange={toggleSelectAll}
                     className="w-4 h-4 rounded-md text-indigo-600 focus:ring-indigo-500 border-slate-300 transition-all cursor-pointer"
                   />
                </th>
                <th className="px-4 py-5 font-bold uppercase tracking-widest text-[#94a3b8] text-[10px]">Kode SKU</th>
                <th className="px-4 py-5 font-bold uppercase tracking-widest text-[#94a3b8] text-[10px]">Nama Barang</th>
                <th className="px-4 py-5 font-bold uppercase tracking-widest text-[#94a3b8] text-[10px] text-center">Stok (PCS)</th>
                <th className="px-4 py-5 font-bold uppercase tracking-widest text-[#94a3b8] text-[10px] text-center">Total Dus</th>
                <th className="px-4 py-5 font-bold uppercase tracking-widest text-[#94a3b8] text-[10px] text-center">Threshold</th>
                {isAdmin && <th className="px-8 py-5 font-bold uppercase tracking-widest text-[#94a3b8] text-[10px] text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredSkus.map(sku => {
                const isLowStock = sku.currentStock <= (sku.threshold ?? 10);
                const isSelected = selectedIds.includes(sku.id);
                const isEditing = editingSKUId === sku.id;

                return (
                  <tr 
                    key={sku.id} 
                    className={`group transition-all duration-200 ${isSelected ? 'bg-indigo-50/30' : 'hover:bg-slate-50/50'}`}
                  >
                    <td className="px-8 py-5">
                      <input 
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(sku.id)}
                        className="w-4 h-4 rounded-md text-indigo-600 focus:ring-indigo-500 border-slate-300 transition-all cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-5">
                      {isEditing ? (
                        <input
                          value={editID}
                          onChange={(e) => setEditID(e.target.value.toUpperCase())}
                          className="bg-white border-2 border-indigo-100 rounded-lg px-2 py-1 text-sm font-black text-slate-900 w-full outline-none focus:border-indigo-400 uppercase tracking-widest"
                        />
                      ) : (
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors tracking-widest">{sku.id}</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(sku.holdStock || 0) > 0 && (
                              <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border border-amber-200 shadow-sm leading-none flex items-center">
                                HOLD: {(sku.holdStock || 0).toLocaleString()}
                              </span>
                            )}
                            {(sku.brokenStock || 0) > 0 && (
                              <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-tighter border border-rose-200 shadow-sm leading-none flex items-center">
                                RUSAK: {(sku.brokenStock || 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-5">
                      {isEditing ? (
                          <input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="bg-white border-2 border-indigo-100 rounded-lg px-2 py-1 text-sm font-bold w-full outline-none focus:border-indigo-400"
                          />
                      ) : (
                          <span className="text-sm font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors">{sku.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-5 text-center">
                      {isEditing ? (
                        <div className="flex flex-col items-center">
                           <span className="text-sm font-black text-slate-400 tabular-nums">
                             {sku.currentStock}
                           </span>
                           <p className="text-[8px] font-black text-slate-300 uppercase leading-none">PCS (Locked)</p>
                        </div>
                      ) : (
                        <span className={`text-lg font-black tabular-nums ${isLowStock ? 'text-red-600' : 'text-slate-800'}`}>
                          {sku.currentStock ?? 0}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-5 text-center">
                       <div className="flex flex-col items-center gap-1.5 py-1 min-w-[140px]">
                          {(() => {
                             // Aggregate logic: Total boxes across all sizes, Total loose pieces
                             const allPossibleSizes = Array.from(new Set([
                                1,
                                Number(sku.pcsPerCarton || 1),
                                ...(sku.detailedStock ? Object.keys(sku.detailedStock).map(Number) : [])
                             ]))
                             .filter(n => n >= 1)
                             .sort((a, b) => b - a);

                             const totalAllBoxes = allPossibleSizes.reduce((acc, size) => {
                                if (size <= 1) return acc;
                                const val = sku.detailedStock ? sku.detailedStock[String(size)] : null;
                                const totalV = (typeof val === 'object' && val !== null) ? (val as any).total : Number(val || 0);
                                return acc + Math.floor(totalV / size);
                             }, 0);

                             const totalAllRem = allPossibleSizes.reduce((acc, size) => {
                                const val = sku.detailedStock ? sku.detailedStock[String(size)] : null;
                                const totalV = (typeof val === 'object' && val !== null) ? (val as any).total : Number(val || 0);
                                if (size <= 1) return acc + totalV;
                                return acc + (totalV % size);
                             }, 0);

                             const selectedSize = displayCartonSize[sku.id] || sku.pcsPerCarton || 1;
                             const val = sku.detailedStock ? sku.detailedStock[String(selectedSize)] : null;
                             const isObj = typeof val === 'object' && val !== null;
                             const totalForSize = isObj ? (val as any).total : Number(val || 0);
                             const boxesForSize = selectedSize > 1 ? Math.floor(totalForSize / selectedSize) : 0;
                             const remForSize = selectedSize > 1 ? totalForSize % selectedSize : totalForSize;

                             return (
                                <div className="flex flex-col items-center gap-2">
                                   <div className="bg-white px-3 py-2.5 rounded-2xl border border-slate-200 shadow-sm w-full group-hover:border-indigo-200 group-hover:bg-indigo-50/30 transition-all">
                                      <div className="flex flex-col items-center">
                                         <div className="flex items-center justify-center gap-1.5">
                                            <span className="text-2xl font-black text-slate-900 tabular-nums leading-none group-hover:text-indigo-900">{totalAllBoxes}</span>
                                            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none group-hover:text-indigo-400">DUS</span>
                                         </div>
                                         {totalAllRem > 0 && (
                                            <div className="bg-orange-50 px-2 py-0.5 rounded-full border border-orange-100 flex items-center gap-1 mt-1">
                                               <span className="w-1 h-1 rounded-full bg-orange-400 animate-pulse"></span>
                                               <span className="text-[9px] font-black text-orange-600 uppercase tracking-widest leading-none">+{totalAllRem} PCS SISA</span>
                                            </div>
                                         )}
                                         <div className="text-[8px] font-bold text-slate-300 uppercase tracking-[0.2em] mt-1 whitespace-nowrap">Total Seluruh Dus</div>
                                      </div>
                                   </div>

                                    {allPossibleSizes.length > 1 && (
                                      <div className="w-full flex flex-col gap-1">
                                         <select
                                            value={selectedSize}
                                            onChange={(e) => setDisplayCartonSize(prev => ({ ...prev, [sku.id]: Number(e.target.value) }))}
                                            className="w-full text-[9px] font-black bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-slate-500 outline-none focus:border-indigo-400 cursor-pointer hover:bg-slate-50 transition-all text-center uppercase"
                                         >
                                            <option value="" disabled>-- LIHAT DETAIL ISI --</option>
                                            {allPossibleSizes.map(s => {
                                               const v = sku.detailedStock ? sku.detailedStock[String(s)] : null;
                                               const totalV = (typeof v === 'object' && v !== null) ? (v as any).total : Number(v || 0);
                                               const b = s > 1 ? Math.floor(totalV / s) : 0;
                                               const r = s > 1 ? totalV % s : totalV;
                                               return (
                                                  <option key={s} value={s}>
                                                     {s > 1 
                                                       ? `ISI ${s} (${b} DUS - ${r} PCS) ${totalV} TOTAL PCS` 
                                                       : `ECERAN (0 DUS - ${totalV} PCS) ${totalV} TOTAL PCS`}
                                                  </option>
                                               );
                                            })}
                                         </select>
                                         <div className="text-[7px] font-bold text-slate-400 uppercase text-center leading-tight">
                                            {selectedSize > 1 
                                              ? `GUDANG ISI ${selectedSize}: (${boxesForSize} DUS - ${remForSize} PCS) ${totalForSize} TOTAL PCS`
                                              : `GUDANG ECERAN: (0 DUS - ${remForSize} PCS) ${totalForSize} TOTAL PCS`}
                                         </div>
                                      </div>
                                   )}
                                </div>
                             );
                          })()}
                       </div>
                    </td>
                    <td className="px-4 py-5 text-center">
                      {isEditing ? (
                        <input
                          type="number"
                          value={editThreshold}
                          onChange={(e) => setEditThreshold(Number(e.target.value))}
                          className="w-20 bg-white border-2 border-indigo-100 rounded-lg px-2 py-1 text-sm font-black text-center outline-none focus:border-indigo-400"
                        />
                      ) : (
                        <span className="text-[10px] font-black text-slate-400 tabular-nums">LIMIT: {sku.threshold ?? 10}</span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-8 py-5 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSave(sku.id)}
                                className="p-2 bg-slate-900 text-white rounded-xl hover:bg-black transition-all active:scale-95"
                                title="Save Changes"
                              >
                                <Save className="w-4 h-4" />
                              </button>
                              <button
                                onClick={cancelEditing}
                                className="p-2 bg-slate-100 text-slate-500 rounded-xl hover:bg-slate-200 transition-all"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => startEditing(sku)}
                                className="p-2 bg-slate-50 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 border border-slate-100 rounded-xl transition-all active:scale-95 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0"
                                title="Edit Item"
                              >
                                <Edit2 className="w-4 h-4" />
                              </button>
                              <AnimatePresence mode="wait">
                                {confirmDeleteId === sku.id ? (
                                  <motion.div 
                                    initial={{ opacity: 0, x: 10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 10 }}
                                    className="flex items-center gap-1 bg-red-50 p-1 rounded-xl"
                                  >
                                    <button
                                      onClick={() => deleteSKU(sku.id)}
                                      className="px-3 py-1 bg-red-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-red-700 transition-all active:scale-95 shadow-lg shadow-red-200"
                                    >
                                      Hapus
                                    </button>
                                    <button
                                      onClick={() => setConfirmDeleteId(null)}
                                      className="p-1 px-2 text-slate-400 hover:text-slate-600 transition-colors font-black text-[10px]"
                                    >
                                      X
                                    </button>
                                  </motion.div>
                                ) : (
                                  <button
                                    onClick={() => setConfirmDeleteId(sku.id)}
                                    disabled={isDeletingSKU === sku.id}
                                    className="p-2 bg-slate-50 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-slate-100 rounded-xl transition-all active:scale-95 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 delay-75"
                                    title="Delete Item"
                                  >
                                    {isDeletingSKU === sku.id ? (
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                      <Trash2 className="w-4 h-4" />
                                    )}
                                  </button>
                                )}
                              </AnimatePresence>
                            </>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      
      {filteredSkus.length === 0 && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-24 bg-white/50 backdrop-blur-sm rounded-[3rem] border-2 border-dashed border-slate-200 flex flex-col items-center justify-center p-8"
        >
          <div className="w-20 h-20 bg-slate-100 rounded-3xl flex items-center justify-center mb-6 text-slate-300">
            <Package className="w-10 h-10" />
          </div>
          <h3 className="text-2xl font-black text-slate-800 mb-2">Gudang Kosong</h3>
          <p className="text-slate-500 max-w-sm font-medium">
            Tidak ada SKU yang ditemukan {search ? `untuk "${search}"` : 'dalam database'}. <br/>
            Coba tambah SKU baru untuk memulai.
          </p>
        </motion.div>
      )}
    </div>
  );
};

export default StokGudang;
