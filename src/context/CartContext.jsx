import { createContext, useState, useContext, useEffect } from 'react';
import { 
    db, 
    serverTimestamp, 
    collection, 
    onSnapshot, 
    query, 
    where, 
    doc, 
    runTransaction, 
    increment,
    setDoc,
    deleteDoc,
    getDocs,
    writeBatch
} from '../firebase';

const CartContext = createContext();

export const useCart = () => useContext(CartContext);

export const CartProvider = ({ children }) => {
    const [cart, setCart] = useState([]);
    const [loading, setLoading] = useState(true);
    const [studentId, setStudentId] = useState(localStorage.getItem('studentId'));

    useEffect(() => {
        // Handle changes to localStorage studentId (e.g. from login/logout)
        const handleSync = () => {
            const sid = localStorage.getItem('studentId');
            if (sid !== studentId) {
                setStudentId(sid);
            }
        };

        window.addEventListener('storage', handleSync);
        // Fallback for same-window updates during navigate()
        const syncInterval = setInterval(handleSync, 1000);

        if (!studentId) {
            setCart([]);
            setLoading(false);
            return () => {
                window.removeEventListener('storage', handleSync);
                clearInterval(syncInterval);
            };
        }

        // Listen to student's cart in Firestore
        const q = query(collection(db, 'carts'), where('studentId', '==', studentId));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const items = snapshot.docs.map(doc => ({ 
                cartDocId: doc.id, 
                ...doc.data() 
            }));
            setCart(items);
            setLoading(false);
        });

        return () => {
            unsubscribe();
            window.removeEventListener('storage', handleSync);
            clearInterval(syncInterval);
        };
    }, [studentId]);

    const addToCart = async (product, quantity) => {
        if (!studentId) return;

        try {
            await runTransaction(db, async (transaction) => {
                const productRef = doc(db, 'products', product.id);
                const productSnap = await transaction.get(productRef);

                if (!productSnap.exists()) throw new Error("المنتج غير موجود");

                const currentStock = productSnap.data().stock || 0;
                if (currentStock < quantity) throw new Error("الكمية المطلوبة غير متوفرة في المخزن");

                // Check if already in cart to update existing or add new
                const cartDocId = `${studentId}_${product.id}`;
                const cartRef = doc(db, 'carts', cartDocId);
                const cartSnap = await transaction.get(cartRef);

                if (cartSnap.exists()) {
                    transaction.update(cartRef, {
                        quantity: increment(quantity),
                        addedAt: serverTimestamp() // Reset expiry time on update
                    });
                } else {
                    transaction.set(cartRef, {
                        studentId,
                        productId: product.id,
                        name: product.name,
                        price: product.price,
                        images: product.images || [],
                        quantity: quantity,
                        addedAt: serverTimestamp()
                    });
                }

                // Deduct from stock (Atomic Increment)
                transaction.update(productRef, {
                    stock: increment(-quantity)
                });
            });
            return true; // Success
        } catch (error) {
            console.error("Add to cart failed:", error);
            alert(error.message);
            throw error; // Re-throw so UI can catch and stop loading
        }
    };

    const removeFromCart = async (productId, currentQuantity) => {
        if (!studentId) return;

        try {
            await runTransaction(db, async (transaction) => {
                const cartDocId = `${studentId}_${productId}`;
                const cartRef = doc(db, 'carts', cartDocId);
                const productRef = doc(db, 'products', productId);

                // Delete from cart
                transaction.delete(cartRef);

                // Return to stock
                transaction.update(productRef, {
                    stock: increment(currentQuantity)
                });
            });
        } catch (error) {
            console.error("Remove from cart failed:", error);
        }
    };

    const updateQuantity = async (productId, newQuantity, oldQuantity) => {
        if (!studentId) return;
        if (newQuantity <= 0) {
            removeFromCart(productId, oldQuantity);
            return;
        }

        const diff = newQuantity - oldQuantity;

        try {
            await runTransaction(db, async (transaction) => {
                const productRef = doc(db, 'products', productId);
                const cartDocId = `${studentId}_${productId}`;
                const cartRef = doc(db, 'carts', cartDocId);
                
                const productSnap = await transaction.get(productRef);
                const currentStock = productSnap.data().stock || 0;

                if (diff > 0 && currentStock < diff) {
                    throw new Error("لا توجد كمية كافية في المخزن");
                }

                transaction.update(cartRef, {
                    quantity: newQuantity,
                    addedAt: serverTimestamp()
                });

                transaction.update(productRef, {
                    stock: increment(-diff)
                });
            });
        } catch (error) {
            console.error("Update quantity failed:", error);
            alert(error.message);
        }
    };

    const clearCartItems = async () => {
        if (!studentId) return;
        // This is primarily for checkout where we DON'T return items to stock
        // since they are now part of an order.
        try {
            const q = query(collection(db, 'carts'), where('studentId', '==', studentId));
            const snapshot = await getDocs(q);
            const batch = writeBatch(db);
            snapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        } catch (error) {
            console.error("Clear cart failed:", error);
        }
    };

    const getCartTotal = () => {
        return cart.reduce((total, item) => total + (item.price * item.quantity), 0);
    };

    const getCartCount = () => {
        return cart.reduce((count, item) => count + item.quantity, 0);
    };

    return (
        <CartContext.Provider value={{
            cart,
            loading,
            addToCart,
            removeFromCart,
            updateQuantity,
            clearCartItems, // Renamed for clarity
            getCartTotal,
            getCartCount
        }}>
            {children}
        </CartContext.Provider>
    );
};
