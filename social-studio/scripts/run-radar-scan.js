'use strict';

const radar = require('../modules/radar');

const trends = radar.getTopTrendingContent({ winnersOnly: false });
const summary = radar.summarizeRadar();

console.log(JSON.stringify({ summary, top: trends.slice(0, 5) }, null, 2));
