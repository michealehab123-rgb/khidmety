import { initializeApp } from "firebase/app";
import { 
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  serverTimestamp, 
  query, 
  collection, 
  where, 
  getDocs, 
  writeBatch, 
  FieldPath, 
  doc, 
  runTransaction, 
  increment,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDoc,
  getDocFromCache,
  orderBy,
  limit,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField
} from "firebase/firestore";
// 👇 ضفنا الإضافات دي هنا عشان المتصفح يفضل فاكر حساب الخادم وما يخرجش أوتوماتيك
import { getAuth, setPersistence, browserLocalPersistence } from "firebase/auth";
import { getAnalytics } from "firebase/analytics";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyD5j3-Gvs3fBkbkFCQypFQ4uZBB3nhAWeI",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "sunday-school-1ecad.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "sunday-school-1ecad",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "sunday-school-1ecad.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "226413393015",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:226413393015:web:c6dde83def51958b748272",
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-FVZGB50RKS"
};

// 1. تهيئة التطبيق والأنااليتكس
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// 2. تهيئة Auth بدون تفعيل حفظ الجلسة التلقائي لمنع التعارض
const auth = getAuth(app);

// 3. تهيئة Firestore وتفعيل الأوفلاين للجداول بالطريقة الحديثة
let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
} catch (error) {
  console.warn("Firestore already initialized, falling back to getFirestore(app):", error);
  db = getFirestore(app);
}

// 4. التصدير لملفات المشروع
export { 
  db, 
  auth, 
  serverTimestamp, 
  query, 
  collection, 
  where, 
  getDocs, 
  writeBatch, 
  FieldPath, 
  doc, 
  runTransaction, 
  increment,
  onSnapshot,
  setDoc,
  deleteDoc,
  getDoc,
  getDocFromCache,
  orderBy,
  limit,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteField
};