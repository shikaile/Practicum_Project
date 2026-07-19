const router = require('express').Router();

const route1 = require('./route1.js');
const teams = require('./teams.js');
const games = require('./games.js');
//const route2 = require('./route2.js');
//const route3 = require('./route3.js');

router.use('/route1', route1);
router.use('/teams', teams);
router.use('/games', games);
//router.use('/route2', route2);
//router.use('/route3', route3);

module.exports = router;