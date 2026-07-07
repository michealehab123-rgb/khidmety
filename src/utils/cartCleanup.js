import { db, query, collection, where, getDocs, writeBatch, doc, increment } from '../firebase';

/**
 * Sweeps the 'carts' collection for items older than 60 minutes,
 * returns them to stock, and deletes the cart records.
 */
export const cleanupExpiredCarts = async () => {
    try {
        const sixtyMinutesAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        // Query all cart items added more than 60 minutes ago
        const q = query(
            collection(db, 'carts'),
            where('addedAt', '<', sixtyMinutesAgo)
        );
        
        const snapshot = await getDocs(q);
        if (snapshot.empty) return;

        console.log(`Cleaning up ${snapshot.size} expired cart items...`);
        
        const batch = writeBatch(db);
        
        for (const cartDoc of snapshot.docs) {
            const data = cartDoc.data();
            const productRef = doc(db, 'products', data.productId);
            
            // Return to stock using increment
            batch.update(productRef, {
                stock: increment(data.quantity)
            });
            
            batch.delete(cartDoc.ref);
        }
        
        await batch.commit();
        console.log('Expired carts cleaned successfully.');
    } catch (error) {
        console.error('Error during cart cleanup:', error);
    }
};
