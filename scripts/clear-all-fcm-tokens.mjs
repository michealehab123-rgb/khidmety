/**
 * clear-all-fcm-tokens.mjs
 * -----------------------------------------------------------------
 * سكريبت لمسح جميع توكنات FCM من جداول servants و students
 * في Firestore علشان نبدأ من نظافة.
 *
 * تشغيل:  node scripts/clear-all-fcm-tokens.mjs
 * -----------------------------------------------------------------
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, updateDoc, doc, deleteField } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD5j3-Gvs3fBkbkFCQypFQ4uZBB3nhAWeI",
  authDomain: "sunday-school-1ecad.firebaseapp.com",
  projectId: "sunday-school-1ecad",
  storageBucket: "sunday-school-1ecad.firebasestorage.app",
  messagingSenderId: "226413393015",
  appId: "1:226413393015:web:c6dde83def51958b748272",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function clearTokensInCollection(collectionName) {
  console.log(`\n[Scanning] collection: ${collectionName}`);
  const snapshot = await getDocs(collection(db, collectionName));
  let cleared = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const hasTokens = data.fcmTokens || data.fcmToken;
    if (hasTokens) {
      await updateDoc(doc(db, collectionName, docSnap.id), {
        fcmTokens: deleteField(),
        fcmToken: deleteField(),
      });
      console.log(`  [OK] Cleared: ${docSnap.id} (${data.name || data.email || 'no name'})`);
      cleared++;
    }
  }

  console.log(`[DONE] ${collectionName}: cleared ${cleared} / ${snapshot.size} documents.`);
}

(async () => {
  try {
    await clearTokensInCollection('servants');
    await clearTokensInCollection('students');
    console.log('\n[SUCCESS] All FCM tokens cleared! Ready for a clean start.\n');
    process.exit(0);
  } catch (err) {
    console.error('[ERROR] Could not clear tokens:', err);
    process.exit(1);
  }
})();
