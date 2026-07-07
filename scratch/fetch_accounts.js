import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyD5j3-Gvs3fBkbkFCQypFQ4uZBB3nhAWeI",
  authDomain: "sunday-school-1ecad.firebaseapp.com",
  projectId: "sunday-school-1ecad",
  storageBucket: "sunday-school-1ecad.firebasestorage.app",
  messagingSenderId: "226413393015",
  appId: "1:226413393015:web:c6dde83def51958b748272",
  measurementId: "G-FVZGB50RKS"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function run() {
  try {
    const servantsSnap = await getDocs(collection(db, "servants"));
    console.log(`--- Servants (${servantsSnap.size}) ---`);
    servantsSnap.forEach(doc => {
      const data = doc.data();
      console.log(`ID: ${doc.id}, Name: ${data.name?.name || data.name || ""}, Role: ${data.role || ""}`);
    });

    const studentsSnap = await getDocs(collection(db, "students"));
    console.log(`--- Students (${studentsSnap.size}) ---`);
    studentsSnap.forEach(doc => {
      const data = doc.data();
      console.log(`ID: ${doc.id}, Name: ${data.name || ""}, Class: ${data.assignedClass || ""}`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
