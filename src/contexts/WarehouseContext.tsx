import React, { createContext, useContext, useState, useEffect } from 'react';
import { collection, query, onSnapshot, orderBy } from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { db, auth } from '../lib/firebase';
import { Warehouse } from '../types';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';

interface WarehouseContextType {
  warehouses: Warehouse[];
  activeWarehouse: Warehouse | null;
  setActiveWarehouse: (warehouse: Warehouse | null) => void;
  loading: boolean;
}

const WarehouseContext = createContext<WarehouseContextType | undefined>(undefined);

export const WarehouseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [activeWarehouse, setActiveWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      setIsAuthenticated(!!user);
      if (!user) {
        setWarehouses([]);
        setActiveWarehouse(null);
        setLoading(false);
      }
    });

    return unsubAuth;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return;

    setLoading(true);
    const q = query(collection(db, 'warehouses'), orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Warehouse));
      setWarehouses(data);
      
      setActiveWarehouse(prev => {
        const savedId = localStorage.getItem('activeWarehouseId');
        
        // 1. If we already have a selected warehouse, try to keep it with refreshed data
        if (prev) {
          const stillExists = data.find(w => w.id === prev.id);
          if (stillExists) return stillExists;
        }
        
        // 2. If no current selection, try from localStorage
        if (savedId) {
          const foundInStorage = data.find(w => w.id === savedId);
          if (foundInStorage) return foundInStorage;
        }
        
        // 3. Fallback to first available warehouse
        return data.length > 0 ? data[0] : null;
      });
      
      setLoading(false);
    }, (err) => {
      console.error("Warehouse listener error:", err);
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'warehouses');
    });

    return unsub;
  }, [isAuthenticated]);

  useEffect(() => {
    if (activeWarehouse) {
      localStorage.setItem('activeWarehouseId', activeWarehouse.id);
    }
  }, [activeWarehouse]);

  return (
    <WarehouseContext.Provider value={{ warehouses, activeWarehouse, setActiveWarehouse, loading }}>
      {children}
    </WarehouseContext.Provider>
  );
};

export const useWarehouse = () => {
  const context = useContext(WarehouseContext);
  if (context === undefined) {
    throw new Error('useWarehouse must be used within a WarehouseProvider');
  }
  return context;
};
