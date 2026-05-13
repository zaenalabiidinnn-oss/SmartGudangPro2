import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { User as UserIcon, Shield, ShieldCheck, Mail, Loader2, Search, Trash2, X, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'ADMIN' | 'STAFF';
  createdAt: string;
}

const UserManagement: React.FC = () => {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    type: 'DELETE' | 'ROLE';
    user: UserProfile | null;
  }>({
    show: false,
    type: 'DELETE',
    user: null
  });

  useEffect(() => {
    const q = query(collection(db, 'users'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const usersData = snapshot.docs.map(doc => ({
        ...doc.data()
      })) as UserProfile[];
      setUsers(usersData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching users:", error);
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'users');
    });

    return () => unsubscribe();
  }, []);

  const toggleRole = async (user: UserProfile) => {
    setConfirmModal({ show: true, type: 'ROLE', user });
  };

  const confirmToggleRole = async () => {
    const user = confirmModal.user;
    if (!user) return;

    const newRole = user.role === 'ADMIN' ? 'STAFF' : 'ADMIN';
    setConfirmModal({ ...confirmModal, show: false });
    setIsUpdating(user.uid);
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        role: newRole
      });
    } catch (err) {
      console.error("Error updating role:", err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
      alert("Gagal memperbarui peran user.");
    } finally {
      setIsUpdating(null);
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    if (user.uid === auth.currentUser?.uid) {
      alert("Anda tidak dapat menghapus akun Anda sendiri dari sini.");
      return;
    }
    setConfirmModal({ show: true, type: 'DELETE', user });
  };

  const confirmDeleteUser = async () => {
    const user = confirmModal.user;
    if (!user) return;

    setConfirmModal({ ...confirmModal, show: false });
    setIsUpdating(user.uid);
    try {
      await deleteDoc(doc(db, 'users', user.uid));
    } catch (err) {
      console.error("Error deleting user:", err);
      handleFirestoreError(err, OperationType.DELETE, `users/${user.uid}`);
      alert("Gagal menghapus akun user.");
    } finally {
      setIsUpdating(null);
    }
  };

  const filteredUsers = users.filter(u => 
    u.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <Loader2 className="w-12 h-12 text-indigo-600 animate-spin mb-4" />
        <p className="text-slate-400 font-bold uppercase tracking-widest text-xs">Menghubungkan ke Database Pengguna...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h2 className="text-4xl font-black text-slate-900 tracking-tighter mb-2">User Management</h2>
          <p className="text-slate-400 font-medium">Kelola hak akses dan peran petugas gudang.</p>
        </div>

        <div className="relative w-full md:w-80">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
          <input
            type="text"
            placeholder="Cari nama atau email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-white border-2 border-slate-100 rounded-2xl pl-12 pr-6 py-3.5 font-bold text-slate-900 focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all shadow-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredUsers.map((user) => (
          <motion.div
            key={user.uid}
            layout
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="group bg-white border-2 border-slate-50 rounded-[2.5rem] p-8 hover:border-indigo-100 hover:shadow-xl hover:shadow-indigo-50/50 transition-all relative overflow-hidden"
          >
            <div className={`absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full transition-colors ${user.role === 'ADMIN' ? 'bg-indigo-50/50' : 'bg-slate-50/50'}`} />
            
            <div className="relative z-10">
              <div className="flex items-center justify-between mb-6">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shadow-inner ${user.role === 'ADMIN' ? 'bg-indigo-600 text-white shadow-indigo-200' : 'bg-slate-100 text-slate-400'}`}>
                  {user.role === 'ADMIN' ? <ShieldCheck className="w-8 h-8" /> : <UserIcon className="w-8 h-8" />}
                </div>
                
                <div className={`px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest ${user.role === 'ADMIN' ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                  {user.role}
                </div>
              </div>

              <h3 className="text-xl font-black text-slate-900 tracking-tight mb-1 truncate">{user.displayName}</h3>
              <div className="flex items-center gap-2 text-slate-400 mb-8">
                <Mail className="w-3.5 h-3.5" />
                <span className="text-xs font-bold truncate">{user.email}</span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => toggleRole(user)}
                  disabled={isUpdating === user.uid}
                  className={`flex-1 py-4 rounded-2xl font-black uppercase text-xs tracking-widest transition-all flex items-center justify-center gap-3 ${
                    user.role === 'ADMIN'
                      ? 'border-2 border-slate-100 text-slate-400 hover:bg-red-50 hover:border-red-100 hover:text-red-500'
                      : 'bg-indigo-600 text-white shadow-xl shadow-indigo-100 hover:bg-slate-900'
                  }`}
                >
                  {isUpdating === user.uid ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {user.role === 'ADMIN' ? (
                        <>
                          <Shield className="w-4 h-4" />
                          Staff
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="w-4 h-4" />
                          Admin
                        </>
                      )}
                    </>
                  )}
                </button>

                {user.uid !== auth.currentUser?.uid && (
                  <button
                    onClick={() => handleDeleteUser(user)}
                    disabled={isUpdating === user.uid}
                    className="p-4 rounded-2xl bg-slate-50 text-slate-300 hover:bg-red-50 hover:text-red-500 transition-all border-2 border-transparent hover:border-red-100"
                    title="Hapus Akun"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {filteredUsers.length === 0 && (
        <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-[3rem] p-24 text-center">
          <p className="text-slate-400 font-black uppercase tracking-[0.2em] text-xs">Tidak ada user ditemukan</p>
        </div>
      )}

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.show && confirmModal.user && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal({ ...confirmModal, show: false })}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative w-full max-w-lg bg-white rounded-[3rem] overflow-hidden shadow-2xl"
            >
              <div className="p-10 text-center">
                <div className={`w-20 h-20 rounded-3xl mx-auto mb-8 flex items-center justify-center ${confirmModal.type === 'DELETE' ? 'bg-red-50 text-red-500' : 'bg-indigo-50 text-indigo-600'}`}>
                  {confirmModal.type === 'DELETE' ? <AlertTriangle className="w-10 h-10" /> : <ShieldCheck className="w-10 h-10" />}
                </div>

                <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-4 uppercase">
                  {confirmModal.type === 'DELETE' ? 'Konfirmasi Hapus' : 'Konfirmasi Peran'}
                </h3>
                
                <p className="text-slate-500 font-medium leading-relaxed mb-10 px-4">
                  {confirmModal.type === 'DELETE' ? (
                    <>Anda akan menghapus akun <span className="font-bold text-slate-900">{confirmModal.user.displayName}</span> secara permanen dari sistem.</>
                  ) : (
                    <>Ubah peran <span className="font-bold text-slate-900">{confirmModal.user.displayName}</span> menjadi <span className="font-bold text-indigo-600">{confirmModal.user.role === 'ADMIN' ? 'STAFF' : 'ADMIN'}</span>?</>
                  )}
                </p>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setConfirmModal({ ...confirmModal, show: false })}
                    className="py-4 rounded-2xl bg-slate-50 text-slate-400 font-black uppercase text-xs tracking-widest hover:bg-slate-100 transition-all border-2 border-transparent"
                  >
                    Batal
                  </button>
                  <button
                    onClick={confirmModal.type === 'DELETE' ? confirmDeleteUser : confirmToggleRole}
                    className={`py-4 rounded-2xl font-black uppercase text-xs tracking-widest text-white shadow-xl transition-all ${
                      confirmModal.type === 'DELETE' 
                        ? 'bg-red-500 hover:bg-red-600 shadow-red-100' 
                        : 'bg-indigo-600 hover:bg-slate-900 shadow-indigo-100'
                    }`}
                  >
                    Ya, Lanjutkan
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UserManagement;
