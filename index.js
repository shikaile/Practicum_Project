import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import firebase from './firebase.js'; // Import your initialized Firebase app

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Example: Access Firestore
// import { getFirestore } from 'firebase/firestore';
// const db = getFirestore(firebase);

const PORT = process.env.PORT || 5050;
app.listen(PORT, () => {
  console.log(`Server is live @ http://localhost:${PORT}`);
});