import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD5j3-Gvs3fBkbkFCQypFQ4uZBB3nhAWeI",
  authDomain: "sunday-school-1ecad.firebaseapp.com",
  projectId: "sunday-school-1ecad",
  storageBucket: "sunday-school-1ecad.firebasestorage.app",
  messagingSenderId: "226413393015",
  appId: "1:226413393015:web:c6dde83def51958b748272"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function inspectAll() {
  console.log("Searching servants...");
  const servantsSnap = await getDocs(collection(db, 'servants'));
  let foundServantKeys = new Set();
  servantsSnap.forEach(doc => {
    Object.keys(doc.data()).forEach(k => foundServantKeys.add(k));
    const data = doc.data();
    for (const key of Object.keys(data)) {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('fcm')) {
        console.log(`  Servant ${doc.id} has field '${key}':`, data[key]);
      }
    }
  });

  console.log("Searching students...");
  const studentsSnap = await getDocs(collection(db, 'students'));
  let foundStudentKeys = new Set();
  studentsSnap.forEach(doc => {
    Object.keys(doc.data()).forEach(k => foundStudentKeys.add(k));
    const data = doc.data();
    for (const key of Object.keys(data)) {
      if (key.toLowerCase().includes('token') || key.toLowerCase().includes('fcm')) {
        console.log(`  Student ${doc.id} has field '${key}':`, data[key]);
      }
    }
  });

  console.log("All unique servant keys:", Array.from(foundServantKeys));
  console.log("All unique student keys:", Array.from(foundStudentKeys));
}

inspectAll().catch(console.error);
