import React, { useState } from 'react';
import { collection, doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { Plus, Trash2, Warehouse as WarehouseIcon, MapPin, Loader2, AlertCircle, Edit2 } from 'lucide-react';
import { motion } from 'motion/react';

interface GudangManagementProps {
  role?: string | null;
}

const GudangManagement: React.FC<GudangManagementProps> = ({ role }) => {
  const { warehouses, activeWarehouse, setActiveWarehouse, loading } = useWarehouse();
  const isAdmin = role === 'ADMIN';
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [warehouseToDelete, setWarehouseToDelete] = useState<{id: string, name: string} | null>(null);
  const [warehouseToEdit, setWarehouseToEdit] = useState<{id: string, name: string, location?: string} | null>(null);
  const [newName, setNewName] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [editName, setEditName] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    setIsSubmitting(true);
    try {
      const id = newName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const warehouseRef = doc(db, 'warehouses', id);
      await setDoc(warehouseRef, {
        id,
        name: newName,
        location: newLocation,
        createdAt: serverTimestamp()
      });
      setNewName('');
      setNewLocation('');
      setShowAddModal(false);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `warehouses/${newName}`);
      alert('Gagal menambah gudang');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (warehouse: any) => {
    setWarehouseToEdit(warehouse);
    setEditName(warehouse.name);
    setEditLocation(warehouse.location || '');
    setShowEditModal(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!warehouseToEdit || !editName.trim()) return;

    setIsSubmitting(true);
    try {
      const warehouseRef = doc(db, 'warehouses', warehouseToEdit.id);
      await setDoc(warehouseRef, {
        name: editName,
        location: editLocation,
      }, { merge: true });
      setShowEditModal(false);
      setWarehouseToEdit(null);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, `warehouses/${warehouseToEdit.id}`);
      alert('Gagal memperbarui gudang');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = (id: string, name: string) => {
    if (warehouses.length <= 1) {
      return;
    }
    setWarehouseToDelete({ id, name });
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!warehouseToDelete) return;
    
    setIsSubmitting(true);
    try {
      await deleteDoc(doc(db, 'warehouses', warehouseToDelete.id));
      setShowDeleteConfirm(false);
      setWarehouseToDelete(null);
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.DELETE, `warehouses/${warehouseToDelete.id}`);
      alert('Gagal menghapus gudang');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Manajemen Gudang</h2>
          <p className="text-slate-500 font-medium mt-1">Kelola lokasi penyimpanan inventaris Anda.</p>
        </div>

        {isAdmin && (
          <button 
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-3 bg-indigo-600 text-white px-8 py-4 rounded-[1.5rem] font-black uppercase text-xs tracking-widest hover:bg-slate-900 transition-all shadow-2xl shadow-indigo-100 active:scale-95"
          >
            <Plus className="w-5 h-5" />
            Tambah Gudang Baru
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {warehouses.map((warehouse) => (
          <motion.div
            key={warehouse.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className={`group relative bg-white p-8 rounded-[2.5rem] border-2 transition-all cursor-pointer ${
              activeWarehouse?.id === warehouse.id 
                ? 'border-indigo-600 shadow-2xl shadow-indigo-50 ring-4 ring-indigo-50' 
                : 'border-slate-100 hover:border-indigo-200'
            }`}
            onClick={() => setActiveWarehouse(warehouse)}
          >
            <div className="flex justify-between items-start mb-6">
              <div className={`p-4 rounded-2xl ${activeWarehouse?.id === warehouse.id ? 'bg-indigo-600 text-white' : 'bg-slate-50 text-slate-400 group-hover:bg-indigo-50 group-hover:text-indigo-600'} transition-colors`}>
                <WarehouseIcon className="w-6 h-6" />
              </div>
              
              {isAdmin && (
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit(warehouse);
                    }}
                    className="p-2 text-slate-300 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                  >
                    <Edit2 className="w-5 h-5" />
                  </button>
                  <button 
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(warehouse.id, warehouse.name);
                    }}
                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              )}
            </div>

            <h3 className="text-xl font-black text-slate-900 leading-tight mb-2 uppercase tracking-tight">{warehouse.name}</h3>
            
            <div className="flex items-center gap-2 text-slate-400 mb-6">
               <MapPin className="w-4 h-4" />
               <span className="text-xs font-bold">{warehouse.location || 'Lokasi tidak ditentukan'}</span>
            </div>

            <div className="pt-6 border-t border-slate-50 flex items-center justify-between">
               <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest">Status</span>
                  <span className={`text-[10px] font-black uppercase tracking-widest ${activeWarehouse?.id === warehouse.id ? 'text-indigo-600' : 'text-slate-300'}`}>
                    {activeWarehouse?.id === warehouse.id ? '● Active View' : 'Inactive'}
                  </span>
               </div>
               
               {activeWarehouse?.id === warehouse.id && (
                 <div className="bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest">
                   Current
                 </div>
               )}
            </div>
          </motion.div>
        ))}
      </div>

      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[3rem] shadow-2xl w-full max-w-md p-10 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600" />
            
            <h3 className="text-2xl font-black text-slate-900 mb-2 leading-tight">Edit Gudang</h3>
            <p className="text-sm text-slate-400 font-medium mb-8">Perbarui informasi titik penyimpanan ini.</p>

            <form onSubmit={saveEdit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Nama Gudang</label>
                <input
                  autoFocus
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Contoh: Gudang Utama"
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Lokasi (Opsional)</label>
                <div className="relative">
                  <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                  <input
                    type="text"
                    value={editLocation}
                    onChange={(e) => setEditLocation(e.target.value)}
                    placeholder="Contoh: Jakarta Barat"
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-16 pr-6 py-4 font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-6 py-4 text-slate-400 font-black uppercase text-xs tracking-widest hover:bg-slate-50 rounded-2xl transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center gap-3 bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-900 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[3rem] shadow-2xl w-full max-w-md p-10 relative overflow-hidden"
          >
            <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600" />
            
            <h3 className="text-2xl font-black text-slate-900 mb-2 leading-tight">Gudang Baru</h3>
            <p className="text-sm text-slate-400 font-medium mb-8">Tambahkan titik penyimpanan baru dalam jaringan Anda.</p>

            <form onSubmit={handleAdd} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Nama Gudang</label>
                <input
                  autoFocus
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Contoh: Gudang Utama"
                  className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
                  required
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest pl-1">Lokasi (Opsional)</label>
                <div className="relative">
                  <MapPin className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="Contoh: Jakarta Barat"
                    className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl pl-16 pr-6 py-4 font-bold focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
                  />
                </div>
              </div>

              <div className="flex gap-4 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-6 py-4 text-slate-400 font-black uppercase text-xs tracking-widest hover:bg-slate-50 rounded-2xl transition-all"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 flex items-center justify-center gap-3 bg-indigo-600 text-white px-6 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-slate-900 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Simpan'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-sm p-8 text-center"
          >
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
              <Trash2 className="w-8 h-8" />
            </div>
            
            <h3 className="text-xl font-black text-slate-900 mb-2 uppercase tracking-tight">Hapus Gudang?</h3>
            <p className="text-sm text-slate-400 font-medium mb-8">
              Seluruh data stok di <span className="text-slate-900 font-black italic">"{warehouseToDelete?.name}"</span> tidak akan terlihat lagi di dashboard utama.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={confirmDelete}
                disabled={isSubmitting}
                className="w-full px-6 py-4 bg-red-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-red-700 transition-all shadow-xl shadow-red-100 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ya, Hapus Sekarang'}
              </button>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setWarehouseToDelete(null);
                }}
                className="w-full px-6 py-4 text-slate-400 font-black uppercase text-xs tracking-widest hover:bg-slate-50 rounded-2xl transition-all"
              >
                Batalkan
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {warehouses.length === 0 && !loading && (
        <div className="bg-orange-50 border-2 border-orange-100 rounded-[2.5rem] p-12 text-center">
            <AlertCircle className="w-12 h-12 text-orange-400 mx-auto mb-4" />
            <h3 className="text-xl font-black text-orange-900 mb-2 uppercase tracking-tight">Belum Ada Gudang</h3>
            <p className="text-orange-600/70 font-bold text-sm max-w-sm mx-auto mb-8">
              Sistem membutuhkan setidaknya satu gudang untuk beroperasi. Silakan tambahkan gudang pertama Anda.
            </p>
            <button 
              onClick={() => setShowAddModal(true)}
              className="bg-orange-500 text-white px-8 py-4 rounded-2xl font-black uppercase text-xs tracking-widest hover:bg-orange-600 transition-all shadow-xl shadow-orange-100"
            >
              Buat Gudang Sekarang
            </button>
        </div>
      )}
    </div>
  );
};

export default GudangManagement;
