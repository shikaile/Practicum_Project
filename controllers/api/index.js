const router = require('express').Router();

const route1 = require('./route1.js');
//const route2 = require('./route2.js');
//const route3 = require('./route3.js');

router.use('/route1', route1);
//router.use('/route2', route2);
//router.use('/route3', route3);

module.exports = router;