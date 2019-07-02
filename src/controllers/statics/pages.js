'use strict';

var async = require('async');

var staticPageController = module.exports;

staticPageController.staticPage = function (req, res, next) {
	async.parallel([
		function () {
			res.render('statics/page', {});
		},
	], next);
};
