// src/lib/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getAuth, onAuthStateChanged, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

/**
 * If your Firebase Storage bucket is actually 'drippr-seller.appspot.com',
 * change storageBucket below accordingly. The value you pasted:
 *   drippr-seller.firebasestorage.app   <-- looks wrong for 'storageBucket'
 * The bucket *name* is usually '<project-id>.appspot.com'.
 */
const firebaseConfig = {
  apiKey: "AIzaSyBzga1hRVNnwtHGI4s3pVlu5brNjDbVQ-o",
  authDomain: "drippr-seller.firebaseapp.com",
  projectId: "drippr-seller",
  storageBucket: "drippr-seller.appspot.com", // <-- verify in Firebase Console
  messagingSenderId: "960556764771",
  appId: "1:960556764771:web:a95399d8340d623c827256",
  measurementId: "G-5LPZL17671",
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);



export { onAuthStateChanged, GoogleAuthProvider };


// expose for ad-hoc admin actions in DevTools
// (remove later when done)
if (typeof window !== "undefined") (window as any).__auth = auth;
;(window as any).auth = auth;