// Cloud Functions entry point. Firebase Hosting can't run Node/Express
// itself - it only serves static files - so every non-static request is
// rewritten (see firebase.json) to this function, which just hands the
// request to the same Express app used for local dev (server.js).
const functions = require('firebase-functions');
const app = require('./server');

exports.app = functions.https.onRequest(app);
