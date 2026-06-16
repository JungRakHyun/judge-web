import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from "firebase/auth";

// 본인의 Firebase 프로젝트 설정값으로 교체하셔야 합니다.
const firebaseConfig = {
  apiKey: "AIzaSyC2CcdqYPIoOLoWsxru8J8-l6wrJ00fq2M",
  authDomain: "rakproject-bd9d1.firebaseapp.com",
  databaseURL: "https://rakproject-bd9d1-default-rtdb.firebaseio.com",
  projectId: "rakproject-bd9d1",
  storageBucket: "rakproject-bd9d1.firebasestorage.app",
  messagingSenderId: "799122720058",
  appId: "1:799122720058:web:521d737a0d4f92a563bc03"
};

// 설정값을 바탕으로 파이어베이스를 켜고(app), 데이터베이스(db)를 밖으로 내보냅니다.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, "testweb");

// 구글 로그인 인증 모듈 초기화
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();