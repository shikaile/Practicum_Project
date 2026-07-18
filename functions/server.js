// app + server
require('dotenv').config();
const express = require('express');
const routes = require('./controllers');
const path = require('path');
const { getSessionFromRequest } = require('./models/sessions');
const app = express();
const PORT = process.env.PORT || 8080;

// Don't advertise the framework in responses.
app.disable('x-powered-by');

// Baseline security headers. Hand-rolled instead of the `helmet` package so
// this works without any new dependency (see README/notes on the npm
// registry being unreachable in some environments this was built in).
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' https://imagedelivery.net https://images.unsplash.com data:",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://code.getmdl.io",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self' https://cdnjs.cloudflare.com https://code.getmdl.io https://www.gstatic.com",
      "connect-src 'self' https://firestore.googleapis.com https://www.googleapis.com",
    ].join('; ')
  );
  next();
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(express.static(path.join(__dirname,'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname,'views'));

// Make navigation data available to every view (used by views/partials/header.ejs)
const navLinks = [
  { label: 'Home', path: '/' },
  { label: 'About', path: '/about' },
  { label: 'Team', path: '/participate' },
  { label: 'Game', path: '/projects' },
  { label: 'Dashboard', path: '/dashboard' },
];

app.use((req, res, next) => {
  res.locals.navLinks = navLinks;
  res.locals.currentPath = req.path;
  res.locals.user = getSessionFromRequest(req);
  next();
});

// Routes
app.use(routes);

// 404 handler
app.use((req, res) => res.status(404).render('pages/404'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('pages/error', { error: err });
});

// Only bind a port for local dev (`node server.js` / `npm start`). When this
// file is required by functions/index.js instead, Cloud Functions handles
// the HTTP listener itself via functions.https.onRequest(app) - calling
// .listen() there too would just try (and fail) to bind a port in a
// serverless container.
if (require.main === module) {
  app.listen(PORT, ()=> {
      console.log(`API server on port ${PORT}`);
      console.log('Press Ctrl+C to quit.');
  });
}

module.exports = app;
