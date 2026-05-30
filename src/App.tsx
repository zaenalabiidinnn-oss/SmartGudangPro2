import React, { useState, useEffect } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  User,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from 'firebase/auth';
import { auth, db } from './lib/firebase';
import { doc, setDoc, getDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './lib/errorHandlers';
import { WarehouseProvider, useWarehouse } from './contexts/WarehouseContext';
import Navbar from './components/Navbar';
import GudangManagement from './components/GudangManagement';
import DataScan from './components/DataScan';
import DataMasuk from './components/DataMasuk';
import DataKeluar from './components/DataKeluar';
import DataRetur from './components/DataRetur';
import StokGudang from './components/StokGudang';
import StokHarian from './components/StokHarian';
import HistoryLogs from './components/HistoryLogs';
import UserManagement from './components/UserManagement';
import { LogIn, LogOut, Loader2, Warehouse, Mail, Lock, User as UserIcon, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

function AppContent() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('STOK');
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedRole, setSelectedRole] = useState('STAFF');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const { activeWarehouse, loading: warehouseLoading } = useWarehouse();
  const isMasterAdmin = user?.email === 'zaenalabiidinnn@gmail.com';

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        // Fetch user profile
        try {
          const profileDoc = await getDoc(doc(db, 'users', u.uid));
          const isBootstrapAdmin = u.email === 'zaenalabiidinnn@gmail.com';
          
          if (profileDoc.exists()) {
            const userData = profileDoc.data();
            if (isBootstrapAdmin && userData.role !== 'ADMIN') {
              await setDoc(doc(db, 'users', u.uid), { ...userData, role: 'ADMIN' }, { merge: true });
              setRole('ADMIN');
            } else {
              setRole(userData.role);
            }
          } else {
            // Create profile for new users
            const newProfile = {
              uid: u.uid,
              email: u.email,
              displayName: u.displayName || 'User',
              role: isBootstrapAdmin ? 'ADMIN' : 'STAFF',
              createdAt: new Date().toISOString()
            };
            await setDoc(doc(db, 'users', u.uid), newProfile);
            setRole(newProfile.role);
          }
        } catch (err: any) {
          console.error("Error fetching user role:", err);
          if (err?.code === 'permission-denied') {
            handleFirestoreError(err, OperationType.GET, `users/${u.uid}`);
          }
          setRole('STAFF');
        }
      }
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const handleGoogleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error(err);
      setAuthError('Login Google gagal.');
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);

    try {
      if (isRegistering) {
        if (!displayName.trim()) throw new Error('Nama harus diisi');
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(userCredential.user, { displayName });
        
        // Save profile to Firestore
        try {
          await setDoc(doc(db, 'users', userCredential.user.uid), {
            uid: userCredential.user.uid,
            email: userCredential.user.email,
            displayName: displayName,
            role: selectedRole,
            createdAt: new Date().toISOString()
          });
        } catch (err) {
          console.error("Error saving user profile:", err);
          handleFirestoreError(err, OperationType.WRITE, `users/${userCredential.user.uid}`);
        }
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (error: any) {
      console.error(error);
      if (error.code === 'auth/email-already-in-use') setAuthError('Email sudah terdaftar');
      else if (error.code === 'auth/invalid-credential') setAuthError('Email atau password salah');
      else if (error.code === 'auth/weak-password') setAuthError('Password terlalu lemah (min. 6 karakter)');
      else setAuthError(error.message || 'Terjadi kesalahan autentikasi');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setRole(null);
      setActiveTab('STOK');
      setAuthError('');
    } catch (err) {
      console.error("Error signing out:", err);
    }
  };

  if (loading || (user && warehouseLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden p-6">
        {/* Background Decorative Elements */}
        <div className="absolute top-0 left-0 w-full h-full pointer-events-none opacity-20">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-indigo-400 rounded-full blur-[120px]" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-400 rounded-full blur-[120px]" />
        </div>

        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white/80 backdrop-blur-xl p-10 md:p-12 rounded-[3.5rem] shadow-2xl shadow-slate-200 focus-within:shadow-indigo-100 max-w-lg w-full border border-white/40 relative z-10"
        >
          <div className="text-center mb-10">
            <motion.div 
              initial={{ y: -20, rotate: -10 }}
              animate={{ y: 0, rotate: 0 }}
              transition={{ type: "spring", damping: 12 }}
              className="w-20 h-20 bg-indigo-600 rounded-[1.5rem] flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-indigo-200"
            >
              <Warehouse className="text-white w-10 h-10" />
            </motion.div>
            
            <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter">
              Smart<span className="text-indigo-600">Gudang</span>
            </h1>
            <p className="text-slate-400 font-bold uppercase tracking-[0.2em] text-[10px]">
              Inventory Management Pro
            </p>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isRegistering && (
              <div className="relative">
                <UserIcon className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
                <input 
                  type="text"
                  placeholder="Nama Lengkap"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                  className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl pl-14 pr-6 py-4 font-bold text-slate-900 focus:bg-white focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
                />
              </div>
            )}

            {isRegistering && (
              <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl">
                <button
                  type="button"
                  onClick={() => setSelectedRole('STAFF')}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                    selectedRole === 'STAFF' 
                      ? 'bg-white text-indigo-600 shadow-sm' 
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Staff
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedRole('ADMIN')}
                  className={`flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                    selectedRole === 'ADMIN' 
                      ? 'bg-indigo-600 text-white shadow-xl shadow-indigo-100' 
                      : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  Admin
                </button>
              </div>
            )}
            
            <div className="relative">
              <Mail className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
              <input 
                type="email"
                placeholder="Alamat Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl pl-14 pr-6 py-4 font-bold text-slate-900 focus:bg-white focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-300" />
              <input 
                type="password"
                placeholder="Kata Sandi"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-slate-50/50 border-2 border-slate-100 rounded-2xl pl-14 pr-6 py-4 font-bold text-slate-900 focus:bg-white focus:border-indigo-400 outline-none transition-all placeholder:text-slate-300"
              />
            </div>

            {authError && (
              <p className="text-[10px] text-red-500 font-black uppercase tracking-widest pl-2">
                {authError}
              </p>
            )}

            <button 
              type="submit"
              disabled={authLoading}
              className="w-full bg-indigo-600 text-white rounded-2xl py-5 font-black uppercase text-xs tracking-widest hover:bg-slate-900 transition-all shadow-xl shadow-indigo-100 flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-50"
            >
              {authLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (
                <>
                  {isRegistering ? 'Daftar Sekarang' : 'Masuk Sistem'}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-100"></div>
            </div>
            <div className="relative flex justify-center text-[10px] uppercase font-black tracking-widest text-slate-300">
              <span className="bg-white/80 backdrop-blur-sm px-4">Atau</span>
            </div>
          </div>

          <button 
            onClick={handleGoogleLogin}
            className="w-full border-2 border-slate-100 text-slate-900 rounded-2xl py-4 font-black uppercase text-[10px] tracking-widest hover:bg-slate-50 transition-all flex items-center justify-center gap-3"
          >
            <img src="https://www.google.com/favicon.ico" className="w-4 h-4" alt="Google" />
            Login dengan Google
          </button>

          <div className="mt-8 text-center">
            <button 
              onClick={() => {
                setIsRegistering(!isRegistering);
                setAuthError('');
              }}
              className="text-slate-400 font-bold text-xs hover:text-indigo-600 transition-colors uppercase tracking-widest"
            >
              {isRegistering ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar'}
            </button>
          </div>
          
          <div className="mt-12 flex items-center justify-center gap-2">
             <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
             <span className="text-[9px] font-black text-slate-300 uppercase tracking-widest">Global Sync Active</span>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24 selection:bg-indigo-100 selection:text-indigo-900">
      <Navbar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        user={user} 
        role={role} 
        isMasterAdmin={isMasterAdmin}
        onLogout={handleLogout} 
      />
      
      <main className="max-w-7xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            {activeTab === 'STOK' && <StokGudang role={role} />}
            {activeTab === 'STOK_HARIAN' && <StokHarian role={role} />}
            {activeTab === 'SCAN' && <DataScan />}
            {activeTab === 'MASUK' && <DataMasuk />}
            {activeTab === 'KELUAR' && <DataKeluar />}
            {activeTab === 'RETUR' && <DataRetur />}
            {activeTab === 'HISTORY' && <HistoryLogs role={role} />}
            {activeTab === 'GUDANG' && (role === 'ADMIN' ? <GudangManagement role={role} /> : <div className="p-12 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">Akses Terbatas: Hanya Admin</div>)}
            {activeTab === 'USERS' && (isMasterAdmin ? <UserManagement /> : <div className="p-12 text-center text-slate-400 font-bold uppercase tracking-widest text-xs">Akses Terbatas: Hanya Master Admin</div>)}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="fixed bottom-6 right-6 pointer-events-none z-40">
        <div className="bg-slate-900/90 backdrop-blur-md text-white text-[10px] font-black px-4 py-2.5 rounded-2xl shadow-2xl uppercase tracking-[0.2em] pointer-events-auto border border-white/10 flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-sm shadow-emerald-500/50" />
          SmartGudang <span className="text-indigo-400">v2.0 PRO</span>
        </div>
      </footer>
    </div>
  );
}

function App() {
  return (
    <WarehouseProvider>
      <AppContent />
    </WarehouseProvider>
  );
}

export default App;
