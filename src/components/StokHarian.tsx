import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, query, where, getDocs, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useWarehouse } from '../contexts/WarehouseContext';
import { Calendar, Search, Filter, Loader2, Package, Inbox, AlertCircle, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface StokHarianProps {
  role?: string | null;
}

interface HistoricalItem {
  skuId: string;
  name: string;
  currentStock: number;
  pcsPerCarton: number;
  detailedStock: Record<string, any>;
  netChange: number;
  masuk: number;
  keluar: number;
  retur: number;
  pemusnahan: number;
}

const StokHarian: React.FC<StokHarianProps> = ({ role }) => {
  const { activeWarehouse } = useWarehouse();
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);
  const [skus, setSkus] = useState<any[]>([]);
  const [historicalData, setHistoricalData] = useState<Record<string, HistoricalItem>>({});
  const [displayCartonSize, setDisplayCartonSize] = useState<Record<string, number>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  // 1. Fetch current SKUs
  useEffect(() => {
    if (!activeWarehouse) return;
    setLoading(true);
    
    const q = query(collection(db, 'skus'), where('warehouseId', '==', activeWarehouse.id));
    const unsub = onSnapshot(q, async (snap) => {
      const currentSkus = snap.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setSkus(currentSkus);
      
      // After getting current SKUs, calculate historical for targetDate
      await calculateHistoricalStock(currentSkus, targetDate);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'skus');
      setLoading(false);
    });

    return unsub;
  }, [activeWarehouse, targetDate]);

  const calculateHistoricalStock = async (currentSkus: any[], date: string) => {
    if (!activeWarehouse) return;
    setLoading(true);
    
    try {
      const newHistorical: Record<string, any> = {};
      
      // Initialize with current data
      currentSkus.forEach((sku: any) => {
        newHistorical[sku.id] = {
          skuId: sku.id,
          name: sku.name,
          currentStock: sku.currentStock || 0,
          pcsPerCarton: sku.pcsPerCarton || 1,
          detailedStock: JSON.parse(JSON.stringify(sku.detailedStock || {})),
          netChange: 0,
          masuk: 0,
          keluar: 0,
          retur: 0,
          pemusnahan: 0
        };
      });

      // Fetch ALL transactions that happened AFTER the selected date
      // We need date > targetDate
      const collections = [
        'history/masuk/records',
        'history/keluar/records',
        'history/retur/records',
        'history/koreksi/records'
      ];

      const allFutureLogs: any[] = [];
      
      for (const collPath of collections) {
        const q = query(
          collection(db, collPath),
          where('warehouseId', '==', activeWarehouse.id),
          where('date', '>', date)
        );
        const snap = await getDocs(q);
        snap.forEach(doc => {
          allFutureLogs.push({ ...doc.data(), _source: collPath.split('/')[1].toUpperCase() });
        });
      }

      // Work backwards: Stock(T) = CurrentStock - NetChange(T+1 to Now)
      allFutureLogs.forEach((log: any) => {
        const hist = newHistorical[log.skuId];
        if (!hist) return;

        const qty = log.quantity || 0;
        const type = log._source; // MASUK, KELUAR, RETUR, KOREKSI
        const pSize = Number(log.pcsPerCarton || 1);
        const sizeKey = String(pSize);
        
        if (!hist.detailedStock[sizeKey]) {
          hist.detailedStock[sizeKey] = { total: 0 };
        }

        const currentVal = typeof hist.detailedStock[sizeKey] === 'object' 
           ? hist.detailedStock[sizeKey].total 
           : Number(hist.detailedStock[sizeKey]);

        // Work backwards
        if (type === 'MASUK' || type === 'RETUR') {
          hist.currentStock -= qty;
          hist.detailedStock[sizeKey] = { total: currentVal - qty };
        } else if (type === 'KELUAR') {
          // EXCLUDE PEMUSNAHAN from affecting currentStock backward
          if (log.type !== 'PEMUSNAHAN') {
            hist.currentStock += qty;
            hist.detailedStock[sizeKey] = { total: currentVal + qty };
          }
        }
      });

      // Also get the stats specifically FOR the target date
      for (const collPath of ['history/masuk/records', 'history/keluar/records', 'history/retur/records']) {
        const q = query(
          collection(db, collPath),
          where('warehouseId', '==', activeWarehouse.id),
          where('date', '==', date)
        );
        const snap = await getDocs(q);
        snap.forEach(doc => {
          const data: any = doc.data();
          const hist = newHistorical[data.skuId];
          if (!hist) return;
          const type = collPath.split('/')[1].toUpperCase();
          if (type === 'MASUK') hist.masuk += data.quantity;
          if (type === 'KELUAR') {
            if (data.type === 'PEMUSNAHAN') {
              hist.pemusnahan += data.quantity;
            } else {
              hist.keluar += data.quantity;
            }
          }
          if (type === 'RETUR') hist.retur += data.quantity;
        });
      }

      setHistoricalData(newHistorical);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredSkus = Object.values(historicalData).filter((item: HistoricalItem) => {
    const s = search.toLowerCase();
    return item.skuId.toLowerCase().includes(s) || item.name.toLowerCase().includes(s);
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="bg-indigo-600/10 p-2 rounded-lg">
              <Calendar className="w-6 h-6 text-indigo-600" />
            </div>
            <h2 className="text-3xl font-black text-slate-900 tracking-tight leading-none uppercase">Stok Harian</h2>
          </div>
          <p className="text-slate-500 font-medium italic">Track saldo stok pada tanggal spesifik (back-calculated).</p>
        </div>

        <div className="flex bg-white p-2 rounded-2xl border border-slate-200 shadow-sm items-center gap-4 min-w-[240px]">
          <div className="pl-2 pr-4 border-r border-slate-100 flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-600" />
            <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none">Pilih Tanggal</span>
          </div>
          <input 
            type="date"
            value={targetDate}
            max={new Date().toISOString().split('T')[0]}
            onChange={(e) => setTargetDate(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none font-black text-lg text-slate-700 tabular-nums focus:ring-0"
          />
        </div>
      </div>

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-2xl shadow-slate-200/30 overflow-hidden flex flex-col min-h-[600px]">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row gap-4 items-stretch sm:items-center bg-slate-50/30">
          <div className="relative flex-1 group">
            <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" />
            <input
              type="text"
              placeholder="Cari SKU atau nama barang..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-2xl focus:ring-4 focus:ring-indigo-100 focus:border-indigo-400 outline-none transition-all font-medium text-slate-700 placeholder:text-slate-400 shadow-sm"
            />
          </div>
          
          <div className="flex items-center gap-2 px-6 py-3 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-2xl">
             <Filter className="w-4 h-4" />
             <span className="text-xs font-black uppercase tracking-widest">{filteredSkus.length} Items Found</span>
          </div>
        </div>

        <div className="overflow-x-auto flex-1">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 text-slate-400 text-[10px] uppercase font-black tracking-widest border-b border-slate-100">
                <th className="px-8 py-5">Informasi Barang</th>
                <th className="px-4 py-5 text-center">Masuk</th>
                <th className="px-4 py-5 text-center">Keluar</th>
                <th className="px-4 py-5 text-center">Dispose</th>
                <th className="px-4 py-5 text-center bg-slate-100/50">Stok Akhir (Pcs)</th>
                <th className="px-8 py-5 text-center bg-indigo-50 text-indigo-600">Total Stok (Dus + Pcs)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-8 py-40 text-center">
                    <Loader2 className="w-10 h-10 animate-spin mx-auto mb-4 text-indigo-200" />
                    <p className="text-sm font-bold text-slate-300 tracking-widest uppercase">Mengkalkulasi Saldo Tanggal...</p>
                  </td>
                </tr>
              ) : filteredSkus.length === 0 ? (
                <tr>
                   <td colSpan={5} className="px-8 py-40 text-center">
                      <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-200">
                         <Inbox className="w-8 h-8" />
                      </div>
                      <p className="text-slate-400 font-bold tracking-tight">Tidak ada data untuk ditampilkan.</p>
                   </td>
                </tr>
              ) : (
                filteredSkus.map((item: HistoricalItem) => {
                  const pcsPerCarton = item.pcsPerCarton || 1;
                  const boxes = pcsPerCarton > 1 ? Math.floor(item.currentStock / pcsPerCarton) : 0;
                  const remPcs = pcsPerCarton > 1 ? item.currentStock % pcsPerCarton : item.currentStock;

                  return (
                    <tr key={item.skuId} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="px-8 py-6">
                        <div className="flex flex-col">
                          <span className="text-sm font-black text-slate-900 uppercase group-hover:text-indigo-600 transition-colors leading-tight">{item.name}</span>
                          <div className="flex items-center gap-2 mt-1">
                             <span className="text-[10px] font-black font-mono text-slate-400 tracking-wider bg-slate-100 px-1.5 py-0.5 rounded uppercase leading-none">{item.skuId}</span>
                             <span className="text-[9px] font-bold text-slate-300 uppercase tracking-tighter">Isi {pcsPerCarton}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-6 text-center">
                         {item.masuk > 0 ? (
                           <div className="flex flex-col items-center">
                              <span className="text-xs font-black text-emerald-600 tabular-nums">+{item.masuk}</span>
                              <div className="flex items-center gap-1 text-[8px] font-black text-emerald-400 tracking-tighter uppercase">
                                 <ArrowUpRight className="w-2 h-2" />
                                 <span>Restock</span>
                              </div>
                           </div>
                         ) : <span className="text-slate-200 text-xs">-</span>}
                      </td>
                      <td className="px-4 py-6 text-center">
                        {item.keluar > 0 ? (
                           <div className="flex flex-col items-center">
                              <span className="text-xs font-black text-rose-600 tabular-nums">-{item.keluar}</span>
                              <div className="flex items-center gap-1 text-[8px] font-black text-rose-400 tracking-tighter uppercase">
                                 <ArrowDownLeft className="w-2 h-2" />
                                 <span>Outgoing</span>
                              </div>
                           </div>
                         ) : <span className="text-slate-200 text-xs">-</span>}
                      </td>
                      <td className="px-4 py-6 text-center">
                        {item.pemusnahan > 0 ? (
                           <div className="flex flex-col items-center">
                              <span className="text-xs font-black text-slate-500 tabular-nums">-{item.pemusnahan}</span>
                              <div className="flex items-center gap-1 text-[8px] font-black text-slate-400 tracking-tighter uppercase">
                                 <AlertCircle className="w-2 h-2" />
                                 <span>Dispose</span>
                              </div>
                           </div>
                         ) : <span className="text-slate-200 text-xs">-</span>}
                      </td>
                      <td className="px-4 py-6 text-center bg-slate-50/30">
                        <span className={`text-sm font-black tabular-nums ${item.currentStock < 0 ? 'text-rose-600' : 'text-slate-700'}`}>
                          {item.currentStock.toLocaleString()}
                        </span>
                      </td>
                      <td className="px-8 py-6 text-center bg-indigo-50/40 relative">
                        <div className="flex flex-col items-center justify-center gap-2">
                           {(() => {
                              // Aggregate logic from StokGudang
                              const allPossibleSizes = Array.from(new Set([
                                 1,
                                 Number(item.pcsPerCarton || 1),
                                 ...(item.detailedStock ? Object.keys(item.detailedStock).map(Number) : [])
                              ]))
                              .filter(n => n >= 1)
                              .sort((a, b) => b - a);

                              const totalAllBoxes = allPossibleSizes.reduce((acc, size) => {
                                 if (size <= 1) return acc;
                                 const val = item.detailedStock ? item.detailedStock[String(size)] : null;
                                 const totalV = (typeof val === 'object' && val !== null) ? (val as any).total : Number(val || 0);
                                 return acc + Math.floor(totalV / size);
                              }, 0);

                              const totalAllRem = allPossibleSizes.reduce((acc, size) => {
                                 const val = item.detailedStock ? item.detailedStock[String(size)] : null;
                                 const totalV = (typeof val === 'object' && val !== null) ? (val as any).total : Number(val || 0);
                                 if (size <= 1) return acc + totalV;
                                 return acc + (totalV % size);
                              }, 0);

                              const selectedSize = displayCartonSize[item.skuId] || item.pcsPerCarton || 1;
                              const val = item.detailedStock ? item.detailedStock[String(selectedSize)] : null;
                              const isObj = typeof val === 'object' && val !== null;
                              const totalForSize = isObj ? (val as any).total : Number(val || 0);
                              const boxesForSize = selectedSize > 1 ? Math.floor(totalForSize / selectedSize) : 0;
                              const remForSize = selectedSize > 1 ? totalForSize % selectedSize : totalForSize;

                              return (
                                 <div className="flex flex-col items-center gap-2">
                                    <div className="bg-white/80 backdrop-blur-sm px-4 py-2 rounded-2xl border border-indigo-100 shadow-sm w-full min-w-[140px]">
                                       <div className="flex flex-col items-center">
                                          <div className="flex items-center justify-center gap-1.5">
                                             <span className="text-2xl font-black text-indigo-600 tabular-nums leading-none tracking-tighter">{totalAllBoxes}</span>
                                             <span className="text-[10px] font-black text-indigo-300 uppercase tracking-widest leading-none">DUS</span>
                                          </div>
                                          {totalAllRem > 0 && (
                                             <div className="flex items-center justify-center gap-1 mt-1 px-1.5 py-0.5 bg-orange-50 rounded-lg">
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
                                             onChange={(e) => setDisplayCartonSize(prev => ({ ...prev, [item.skuId]: Number(e.target.value) }))}
                                             className="w-full text-[9px] font-black bg-white border border-slate-200 rounded-xl px-2 py-1.5 text-slate-500 outline-none focus:border-indigo-400 cursor-pointer hover:bg-slate-50 transition-all text-center uppercase"
                                          >
                                             <option value="" disabled>-- LIHAT DETAIL ISI --</option>
                                             {allPossibleSizes.map(s => {
                                                const v = item.detailedStock ? item.detailedStock[String(s)] : null;
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
                        {item.currentStock < 0 && (
                           <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-100 text-red-600 px-2 py-0.5 rounded-full ring-2 ring-white animate-bounce-slow">
                              <AlertCircle className="w-3 h-3" />
                              <span className="text-[8px] font-black">MINUS</span>
                           </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="p-8 bg-slate-900 border-t border-slate-700">
           <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 flex items-center justify-center shrink-0 border border-indigo-500/20">
                 <AlertCircle className="w-6 h-6 text-indigo-400" />
              </div>
              <div>
                 <h4 className="text-white font-black uppercase text-xs tracking-widest mb-1">Riwayat Stok Harian</h4>
                 <p className="text-slate-400 text-[11px] leading-relaxed max-w-2xl font-medium">
                    Menu ini berfungsi untuk melacak riwayat saldo stok di masa lalu. Data dihitung dengan cara melakukan pencatatan mundur dari total stok saat ini berdasarkan transaksi yang terekam. 
                    Pastikan seluruh transaksi diinput sesuai dengan tanggal kejadiannya untuk akurasi data riwayat yang maksimal.
                 </p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
};

export default StokHarian;
