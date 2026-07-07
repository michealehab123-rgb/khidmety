import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, orderBy, query } from "firebase/firestore";

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
  console.log("Fetching notifications...");
  try {
    const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    console.log(`Found ${snap.size} notifications:`);
    snap.forEach(doc => {
      const data = doc.data();
      console.log("-----------------------------------------");
      console.log(`ID: ${doc.id}`);
      console.log(`Title: ${data.title}`);
      console.log(`Body: ${data.body}`);
      console.log(`Sender: ${data.senderName} (${data.senderRole}) / ID: ${data.senderId}`);
      console.log(`RecipientType: ${data.recipientType}`);
      console.log(`RecipientIds Count: ${data.recipientIds?.length || 0}`);
      console.log(`RecipientIds:`, data.recipientIds);
      console.log(`CreatedAt: ${data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : "null"}`);
      console.log(`PublishAt: ${data.publishAt?.toDate ? data.publishAt.toDate().toISOString() : "null"}`);
    });
  } catch (error) {
    console.error("Error:", error);
  }
}

run();
